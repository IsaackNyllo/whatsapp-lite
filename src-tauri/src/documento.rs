// PDF para a IA ver (Fase 19): o Windows desenha cada página (Windows.Data.Pdf, WinRT) em JPEG.
// A página do WhatsApp baixa o arquivo (só ela decifra a mídia) e manda em base64; aqui só se desenha.
// Nada é executado nem salvo em disco: o PDF fica em memória durante a chamada.

use serde_json::{json, Value};

/// Páginas por chamada (a IA pede as próximas com `pagina`).
pub const POR_VEZ: u32 = 5;
/// Maior lado da página em px (assumido: legível e perto do tamanho que a IA usa sem reduzir).
const LADO: f32 = 1280.0;

/// Base64 padrão, para devolver o JPEG à página.
fn para_base64(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            s.push(if i <= c.len() { A[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

/// Desenha as páginas `[primeira, primeira + POR_VEZ)` (contadas de 1). Devolve o total de páginas e os JPEGs.
#[cfg(windows)]
pub fn desenhar(pdf: &[u8], primeira: u32) -> Result<(u32, Vec<Vec<u8>>), String> {
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Graphics::Imaging::BitmapEncoder;
    use windows::Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    let pdf = pdf.to_vec();
    // thread própria, com o WinRT iniciado (as threads do Tauri não iniciam)
    std::thread::spawn(move || -> Result<(u32, Vec<Vec<u8>>), String> {
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let e = |x: windows::core::Error| x.message();
        let entrada = InMemoryRandomAccessStream::new().map_err(e)?;
        let w = DataWriter::CreateDataWriter(&entrada).map_err(e)?;
        w.WriteBytes(&pdf).map_err(e)?;
        w.StoreAsync().map_err(e)?.get().map_err(e)?;
        w.DetachStream().map_err(e)?;
        entrada.Seek(0).map_err(e)?;
        let doc = PdfDocument::LoadFromStreamAsync(&entrada).and_then(|op| op.get()).map_err(|x| {
            // 0x8007052B = senha errada (documento protegido)
            if x.code().0 as u32 == 0x8007_052B { "PDF protegido por senha: não dá para abrir.".to_string() }
            else { "PDF corrompido ou inválido: não dá para abrir.".to_string() }
        })?;
        let total = doc.PageCount().map_err(e)?;
        let jpeg = BitmapEncoder::JpegEncoderId().map_err(e)?;
        let mut out = Vec::new();
        for i in primeira.max(1) - 1..(primeira.max(1) - 1 + POR_VEZ).min(total) {
            let pag = doc.GetPage(i).map_err(e)?;
            let t = pag.Size().map_err(e)?;
            let k = LADO / t.Width.max(t.Height).max(1.0);
            let op = PdfPageRenderOptions::new().map_err(e)?;
            op.SetDestinationWidth((t.Width * k).round().max(1.0) as u32).map_err(e)?;
            op.SetDestinationHeight((t.Height * k).round().max(1.0) as u32).map_err(e)?;
            op.SetBitmapEncoderId(jpeg).map_err(e)?;
            let saida = InMemoryRandomAccessStream::new().map_err(e)?;
            pag.RenderWithOptionsToStreamAsync(&saida, &op).map_err(e)?.get().map_err(e)?;
            let n = saida.Size().map_err(e)? as u32;
            let r = DataReader::CreateDataReader(&saida.GetInputStreamAt(0).map_err(e)?).map_err(e)?;
            r.LoadAsync(n).map_err(e)?.get().map_err(e)?;
            let mut b = vec![0u8; n as usize];
            r.ReadBytes(&mut b).map_err(e)?;
            out.push(b);
        }
        Ok((total, out))
    })
    .join()
    .map_err(|_| "Falha ao desenhar o PDF.".to_string())?
}

#[cfg(not(windows))]
pub fn desenhar(_: &[u8], _: u32) -> Result<(u32, Vec<Vec<u8>>), String> {
    Err("PDF só no Windows.".into())
}

/// A página manda o PDF (base64) e a primeira página pedida; volta o total e até 5 JPEGs (base64).
/// Não é ação sensível: só desenha o que a página já tem. Async: não trava a janela.
#[tauri::command]
pub async fn doc_pdf(pdf: String, pagina: u32) -> Result<Value, String> {
    let r = tauri::async_runtime::spawn_blocking(move || {
        let b = crate::transcricao::de_base64(&pdf).ok_or("PDF inválido.")?;
        if !b.starts_with(b"%PDF") {
            return Err("O arquivo não é um PDF de verdade: não dá para abrir.".to_string());
        }
        desenhar(&b, pagina)
    })
    .await
    .map_err(|_| "Falha ao desenhar o PDF.".to_string())??;
    Ok(json!({ "paginas": r.0, "imagens": r.1.iter().map(|j| para_base64(j)).collect::<Vec<_>>() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PDF mínimo com `n` páginas A4 (texto "Pagina i"), xref certo.
    fn pdf(n: u32) -> Vec<u8> {
        let mut objs = vec!["<< /Type /Catalog /Pages 2 0 R >>".to_string()];
        let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 4 + 2 * i)).collect();
        objs.push(format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")));
        objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into());
        for i in 0..n {
            objs.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>", 5 + 2 * i));
            let s = format!("BT /F1 48 Tf 100 700 Td (Pagina {}) Tj ET", i + 1);
            objs.push(format!("<< /Length {} >>\nstream\n{s}\nendstream", s.len()));
        }
        let mut b = b"%PDF-1.4\n".to_vec();
        let mut offs = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offs.push(b.len());
            b.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).bytes());
        }
        let x = b.len();
        b.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for o in offs {
            b.extend(format!("{o:010} 00000 n \n").bytes());
        }
        b.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n", objs.len() + 1).bytes());
        b
    }

    /// largura e altura de um JPEG (marcador SOF)
    fn lado(b: &[u8]) -> (u32, u32) {
        let mut i = 2;
        while i + 9 < b.len() {
            if b[i] != 0xff { i += 1; continue; }
            let m = b[i + 1];
            if (0xc0..=0xcf).contains(&m) && ![0xc4, 0xc8, 0xcc].contains(&m) {
                return (u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32, u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32);
            }
            i += 2 + u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        }
        (0, 0)
    }

    #[test]
    fn base64_ida() {
        assert_eq!(para_base64(b"Man"), "TWFu");
        assert_eq!(para_base64(b"Ma"), "TWE=");
        assert_eq!(para_base64(b"M"), "TQ==");
        let v: Vec<u8> = (0..=255).collect();
        assert_eq!(crate::transcricao::de_base64(&para_base64(&v)).unwrap(), v);
    }

    #[cfg(windows)]
    #[test]
    fn pdf_em_paginas() {
        let p = pdf(12);
        let (total, jpgs) = desenhar(&p, 1).unwrap();
        assert_eq!((total, jpgs.len()), (12, 5), "5 por vez");
        for j in &jpgs {
            assert!(j.starts_with(&[0xff, 0xd8]), "JPEG");
            let (w, h) = lado(j);
            assert_eq!(h, 1280, "maior lado 1280 (retrato)");
            assert!((900..=910).contains(&w), "proporção A4: {w}");
        }
        assert_ne!(jpgs[0], jpgs[1], "páginas diferentes");
        let (_, fim) = desenhar(&p, 11).unwrap();
        assert_eq!(fim.len(), 2, "11 e 12");
        assert!(desenhar(&p, 13).unwrap().1.is_empty(), "depois do fim: nenhuma");
        assert!(desenhar(b"%PDF-1.4 lixo", 1).unwrap_err().contains("corrompido"));
        let mut cortado = p.clone();
        cortado.truncate(p.len() / 3);
        assert!(desenhar(&cortado, 1).is_err(), "PDF cortado dá erro, sem travar");
    }
}
