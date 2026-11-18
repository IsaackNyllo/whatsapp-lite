<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Zap⁺" width="96" height="96">
</p>

<h1 align="center">Zap⁺</h1>

<p align="center">
  WhatsApp Web num app leve para Windows, com conectores de IA, feito com Tauri e Rust.
</p>

Zap⁺ (nome técnico `zap-plus`) é um fork do [WhatsApp Lite](https://github.com/Igoxrx/whatsapp-lite), de Igoxrx, que por sua vez nasceu do [WhatsApp Lite Desktop](https://github.com/leonardo-matheus/whatsapp-lite), de Leonardo Matheus. Versão 1.4.0.

O app abre o WhatsApp Web oficial no WebView2 do Windows, em vez de embutir um navegador inteiro como o WhatsApp Desktop baseado em Electron.

## O que tem

- **Janela fixa e modo celular:** a lista de conversas ocupa a janela; ao abrir uma conversa, só o chat aparece, com botão de voltar. Em janelas estreitas, a barra de Conversas, Status, Canais e Comunidades vai para o rodapé.
- **Bolinha:** o app pode ficar reduzido a uma bolinha flutuante.
- **Configurações** dentro do app.
- **Segundo plano, notificações e aviso dentro da conversa** quando chega mensagem de outra conversa.
- **Downloads com "Salvar como"**, arrastar arquivos para a conversa, links no navegador padrão.
- **Conectores de IA (MCP):** deixa uma IA, como o Claude ou o Gemini, ler as suas conversas por um servidor MCP local.
  - **Leitura completa:** texto, áudios (transcritos no próprio PC), imagens, figurinhas, GIFs, documentos (PDF, Word, Excel, PowerPoint) e enquetes com votos.
  - **Segurança contra ordens escondidas:** mensagem que parece ordem para uma IA (injeção de prompt) ou comando de computador chega trocada por "mensagem retida para revisão". Você revisa as retidas no app, agrupadas por conversa.
  - **Escrever com limite por canal:** a IA só envia texto para os canais que você liberar, com limite por hora para cada um e intervalo entre envios.
  - **Acesso pelo celular:** com o acesso de fora ligado, dá para usar o Claude e o Gemini no celular. A conexão exige chave, e os pedidos recusados ficam registrados sem guardar códigos nem senhas.
  - Ações sensíveis pedem uma caixa Sim/Não no app.

## Instalação

1. Baixe o instalador (`..._x64-setup.exe`) em [Releases](https://github.com/IsaackNyllo/zap-plus/releases/latest).
2. Abra o instalador. Ele não tem assinatura digital, então o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Abra o app e leia o QR code com o celular, como no WhatsApp Web.

O app precisa do WebView2, que já vem no Windows 11. Se faltar, o instalador baixa.

## Compilar

Requisitos: [Rust](https://rustup.rs/) e [Node.js](https://nodejs.org/) (só para a CLI do Tauri).

```bash
git clone https://github.com/IsaackNyllo/zap-plus.git
cd zap-plus/src-tauri
npx @tauri-apps/cli@2 build --bundles nsis
```

O instalador fica em `src-tauri/target/release/bundle/nsis/`.

## Aviso

Projeto de uso pessoal, sem garantia. Este é um cliente não oficial: não é afiliado, associado nem endossado pelo WhatsApp ou pela Meta, e só carrega o WhatsApp Web oficial. Use a leitura por IA só com conversas que você pode compartilhar.

## Licença

MIT, como o projeto original. Veja [LICENSE](LICENSE).
