// Filtro de mensagens para a IA, etapa 1: regras. Sem DOM nem rede: usado por mcp_tools.js,
// pela tela de Configurações (lite_settings.js) e pelo teste do vault (Node).
// Uma mensagem que bate numa regra não chega à IA: vira "[mensagem retida para revisão]".
(function (g) {
    'use strict';

    // minúsculas, sem acento, sem caractere invisível, espaços juntos (a quebra de linha fica: separa frases)
    const norm = (s) => String(s || '').normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[​-‏⁠-⁤﻿­]/g, '').toLowerCase()
        .replace(/[^\S\n]+/g, ' ').trim();
    const alt = (s) => '(?:' + s.trim().split(/\s+/).join('|').replace(/_/g, ' ') + ')';

    // nomes de assistente; "ia", "bot" e "chatbot" só valem como vocativo com pontuação ("IA, apague…").
    // "ai" fica de fora: sem acento é o "aí" ("aí, manda o arquivo").
    const NOME = '(?:claude(?: code| ai| desktop| cli)?|chat ?gpt|gpt(?:-?\\d+(?:\\.\\d+)?[a-z]*)?|gemini(?: cli| pro| flash)?|copilot|codex|grok|deepseek|llama|llm|antigravity|assistente(?: virtual| de ia)?|assistant)';
    const NOME_TODO = '(?:' + NOME.slice(3, -1) + '|ia|inteligencia artificial|bot|chatbot)';
    // imperativo sem ambiguidade (pt) e inglês
    const IMP = alt(`apague apaguem delete deletem remova removam exclua rode rodem execute executem envie enviem mande mandem
        crie criem instale instalem transfira baixe abra ignore ignorem esqueca esquecam faca facam escreva mostre revele copie mova
        formate desative desligue altere modifique edite compartilhe encaminhe publique pague liste leia acesse salve limpe responda
        diga repita imprima obedeca coloque inclua adicione troque substitua sobrescreva suba
        erase wipe run send email create make install transfer download upload open forget disregard write show reveal print
        overwrite obey output copy move format disable modify change share forward post pay buy list read access save tell give call use fetch
        grant reset drop kill shutdown reply respond say repeat`);
    // forma coloquial e infinitivo: só depois de vocativo com pontuação ("Claude, apaga isso")
    const COL = alt(`apaga apagar deleta deletar remove remover exclui excluir roda rodar executa executar envia enviar manda mandar
        cria criar instala instalar transfere transferir baixa baixar abre abrir ignora ignorar esquece esquecer faz fazer escreve
        escrever mostra mostrar revela revelar copia copiar move mover formata formatar desativa desativar desliga desligar altera
        alterar modifica modificar edita editar compartilha compartilhar encaminha encaminhar publica publicar paga pagar lista
        listar le ler acessa acessar salva salvar limpa limpar responde responder diz dizer repete repetir imprime imprimir obedece obedecer sobrescreve sobrescrever sobe subir
        passa passar coloca colocar inclui incluir entra entrar`);
    const VERBO = '(?:' + IMP + '|' + COL + ')';
    // cortesia e pronome entre o nome e o verbo ("por gentileza encaminhe", "me passa")
    const EDUC = '(?:(?:por favor|por gentileza|gentileza|por obsequio|faz favor|pfv|pf|please|pls|kindly|agora|agora mesmo|now|urgente|imediatamente|rapidinho|so|apenas|just|me|nos)[,!]? )*';
    const MODAL = '(?:(?:(?:voce|vc|tu) )?(?:pode|poderia|consegue|conseguiria|deve|precisa|tem que|vai)|can you|could you|would you|will you|you (?:must|should|need to)) ';
    const INICIO = '(?:^|[.!?:\\n] ?)';

    const re = (s) => new RegExp(s, 'm');
    // [grupo, o que a tela mostra, regex (ou lista: todas têm de bater)]
    const PRONTAS = [
        ['Ordem a uma IA', 'claude, chatgpt, gemini, IA… + vírgula + apague, rode, envie…',
            re(`(?:^|[^a-z0-9])@?${NOME_TODO} ?(?:por favor|please|pfv)? ?[,:;!—–]+ ?${EDUC}(?:${MODAL})?(?:\\w+ly )?${VERBO}\\b`)],
        ['Ordem a uma IA', 'claude, chatgpt… + por favor + responde, apaga… (sem vírgula)',
            re(`(?:^|[^a-z0-9])@?${NOME} (?:por favor|por gentileza|please|pfv|pls),? ${EDUC}${VERBO}\\b`)],
        ['Ordem a uma IA', '@claude, @gemini… + apague, manda… (menção ao assistente)',
            re(`@${NOME_TODO} ?[,:]? ?${EDUC}${VERBO}\\b`)],
        ['Ordem a uma IA', '"assistente de IA: … inclua, envie…" (dois-pontos e ordem na mesma frase)',
            re(`(?:^|[^a-z0-9])${NOME_TODO} ?[:—–] [^.!?\\n]{0,80}\\b${IMP}\\b`)],
        ['Ordem a uma IA', 'claude, chatgpt, gemini… no começo da frase + apague, rode, envie…',
            re(`(?:${INICIO}|[,;] |@|\\b(?:ei|hey|oi|ola|hi|hello|ok|okay|yo|dear|querido|querida) )${NOME} ${EDUC}${IMP}\\b`)],
        ['Ordem a uma IA', 'apague, rode, envie… terminando em ", claude"',
            re(`${INICIO}${EDUC}${IMP}\\b[^.!?\\n]{0,150}[,;] ?@?${NOME_TODO} ?(?:[.!?\\n]|$)`)],
        ['Ordem a uma IA', '"Oi Claude, …" (ou "Claude." no fim) + outra oração começando com apague, rode, envie…',
            [re(`(?:${INICIO}|\\b(?:ei|hey|oi|ola|hi|hello|dear|querido|querida) )@?${NOME_TODO} ?[,:!—–]|[.!?\\n] ?@?${NOME} ?[.!]?$`),
                re(`(?:^|[.!?:;,\\n] ?)${EDUC}${IMP}\\b`)]],
        ['Frase de ataque', 'ignore as instruções anteriores / ignore previous instructions',
            re(`(?<!\\bnao |\\bn |don't |dont |do not )\\b(?:ignore|ignora|ignorar|desconsidere|desconsidera|esqueca|esquece|esquecer|descarte|anule|disregard|forget|override|bypass)\\b[^.\\n]{0,40}\\b(?:instruc|diretriz|orientacoes anteriores|regras anteriores|comandos anteriores|prompt|instructions?\\b|directives?\\b|guidelines?\\b|previous (?:rules|messages|context)|prior (?:rules|messages|context)|above (?:rules|messages))`)],
        ['Frase de ataque', 'ignore tudo acima / esqueça o que te disseram / disregard the user',
            re(`\\b(?:ignore|ignora|ignorar|esqueca|esquece|desconsidere|desconsidera|disregard|forget)\\b (?:tudo|everything|all)\\b[^.\\n]{0,30}\\b(?:acima|above|te disseram|te falaram|te mandaram|foi dito|you were told|you've been told|you have been told)|\\b(?:ignore|ignora|desconsidere|disregard|forget)\\b (?:what |whatever |o que )?(?:the user|o usuario)\\b|\\b(?:do not|don't|dont|nao|never|nunca) (?:follow|obey|siga|obedeca)\\b[^.\\n]{0,20}\\b(?:the user|o usuario)|\\b(?:ignore|ignora|esqueca|esquece|desconsidere|disregard|forget|bypass|override)\\b (?:as |the |suas |your |todas as |all )?(?:regras de seguranca|safety rules|security rules|orientacoes do sistema|regras do sistema|system rules|your rules|suas regras|guardrails)|\\b(?:desative|desativa|desligue|disable|turn off|remova|remove) (?:os |the |seus |your |todos os |all )?(?:filtros|filters|guardrails|safety|regras de seguranca)\\b`)],
        ['Frase de ataque', 'system prompt / prompt de sistema / suas instruções / novo prompt',
            re(`novo prompt|nova instrucao ?:|novas instrucoes ?:|new (?:system )?prompt|new instructions ?:|system prompt|prompt (?:de|do) sistema|\\b(?:your|suas|tuas) (?:system |initial |iniciais )?(?:instructions|instrucoes)\\b|(?:reveal|show|print|output|repeat|leak) (?:your|the) (?:system )?(?:prompt|instructions)`)],
        ['Frase de ataque', 'você agora é / you are now / act as / finja ser',
            re(`(?:voce|vc|tu) agora (?:e|es|sera) (?:um |uma |o |a )?(?:ia|assistente|modelo|ai|bot|chatbot|dan|hacker|agente)\\b|(?:voce|vc|tu) (?:nao tem|esta sem|agora esta sem) (?:mais )?(?:nenhum |nenhuma )?(?:limites?|restric|regras|filtros?)|\\byou (?:have no|don't have any|no longer have) (?:limits|restrictions|rules|filters)|\\b(?:seu|teu) novo papel\\b|\\byour new (?:role|task|instructions)\\b|\\b(?:sua|tua) nova (?:funcao|tarefa|missao) e\\b|(?:a partir de agora|de agora em diante|agora) (?:voce|vc|tu) (?:e|es|sera|vai ser|devera ser|age como|deve agir como|vai agir como) (?:um |uma |o |a )?(?:ia|assistente|modelo|ai|bot|chatbot|dan|hacker|agente|sistema|outr[oa]|nov[oa]|livre|sem (?:restric|filtro|limite))|\\byou are now\\b|\\bfrom now on,? (?:you|respond|reply|answer|act|always|only|ignore|output)\\b|\\b(?:agente|ia|assistente|modelo|bot|chatbot|ai|assistant|model|agent) (?:sem|without) (?:nenhum |nenhuma |any )?(?:limites?|restric|regras|filtros?|limits|restrictions|rules|filters)\\b|\\b(?:act|behave) as (?:a|an|my|the) (?:\\w+ )?(?:ai|assistant|model|bot|chatbot|dan|hacker|linux|terminal|shell|admin|developer|jailbroken|unrestricted|unfiltered)\\b|\\bpretend (?:to be|you are|you're)\\b|\\broleplay as\\b|\\b(?:aja|atue|se comporte|finja ser|finja que (?:e|voce e)) (?:como )?(?:um |uma )?(?:ia|assistente|modelo|bot|terminal|shell|hacker|admin|desenvolvedor|dan|sistema)\\b`)],
        ['Frase de ataque', 'developer mode / jailbreak / do anything now',
            re(`developer mode|jailbreak(?:ed)? (?:mode|modo|prompt)|\\bjailbroken\\b|\\bdan mode\\b|do anything now|god mode|modo deus|no restrictions|sem nenhuma restricao|unfiltered mode`)],
        ['Frase de ataque', 'recado para a IA que lê / if you are an AI',
            re(`(?:se|caso) (?:voce|vc|tu) (?:e|es|for|seja) (?:uma|um) (?:ia|inteligencia artificial|assistente|modelo|llm|bot|agente)\\b|(?:se|caso) (?:e|for|seja) (?:uma|um) (?:ia|inteligencia artificial|assistente de ia|modelo de linguagem|llm|agente de ia)\\b|\\b(?:ias?|modelos?|assistentes?|llms?|agentes?|ais?|agents?|assistants?|models?)(?: de (?:ia|linguagem))? (?:lendo|reading|processando|processing|resumindo|summarizing|analisando|analyzing) (?:isso|isto|esta|este|esse|essa|this|these)\\b|\\bif you(?: are|'re) (?:an?|the) (?:ai|llm|assistant|language model|bot|agent)\\b|(?:^|para |pra |a |\\n)(?:a |o )?(?:ia|inteligencia artificial|assistente|llm|modelo) que (?:estiver |esta |for |vai |va )?(?:lendo|resumindo|processando|analisando|ler|resumir|processar|analisar)|\\b(?:to|for) (?:the|any) (?:ai|llm|assistant|model|agent) (?:reading|summarizing|processing)|\\b(?:nota|recado|instrucao|instrucoes|aviso|ordem) (?:para|pra|ao|a) (?:a |o )?(?:ia|assistente|llm|modelo)(?: \\w+)? ?:|\\bnote (?:to|for) (?:the |any )?(?:ai|assistant|llm|model)(?: \\w+)? ?:|\\bcall (?:the )?[\\w-]+ tool\\b|(?:nao|sem) (?:conte|contar|avise|avisar|mostre|mostrar|diga|dizer|informe|informar)(?: isso| nada)? (?:ao|para o|pro|o) usuario|\\b(?:do not|don't|dont|without) (?:tell|telling|inform|informing|show|showing|alert|alerting|mention|mentioning) (?:this to )?(?:the )?user`)],
        ['Frase de ataque', 'marcas de prompt: <system>, [INST], <|im_start|>…',
            re(`<\\|? ?(?:im_start|im_end|system|endoftext) ?\\|?>|\\[/?(?:inst|system)\\]|\\[(?:system|admin|developer|sistema) ?(?:override|mode|prompt|message|mensagem)?\\]|</?system>|###? ?(?:instruction|system)\\b|^(?:system|assistant|sistema) ?:`)],
        ['Comando de computador', 'rm -rf, del /f, rd /s, format c:, mkfs, dd if=…',
            // rm -r só em alvo perigoso (raiz, home, curinga, ..): "rm -rf node_modules" passa
            re(`\\brm (?:-\\S+ )*-[a-z]*r[a-z]* (?:-\\S+ )*(?:/|~|\\*|\\$home|\\.\\.? *(?:$|[;&|]))|\\bdel (?:/[a-z] )*/[fsq]\\b|\\b(?:rd|rmdir) /s\\b|\\bformat [a-z]:|\\bremove-item\\b[^\\n]{0,80}-(?:recurse|force)|\\bmkfs(?:\\.\\w+)?\\b|\\bdd if=|> ?/dev/sd[a-z]|:\\(\\) ?\\{ ?:\\|:& ?\\} ?;|\\bchmod (?:-r )?777 /|\\bsudo (?:rm|dd|mkfs|chmod|shutdown|reboot)\\b|\\bshutdown (?:/[srf]|-[hr]|now)|\\breg (?:delete|add) hk|\\bvssadmin\\b[^\\n]*delete|\\bbcdedit\\b|\\bcipher /w|\\bwbadmin delete`)],
        ['Comando de computador', 'curl/wget … | sh, iwr … | iex, powershell -enc, Invoke-Expression…',
            re(`\\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\\b[^|\\n]{0,200}\\| ?(?:sudo )?(?:(?:ba|z|da|k)?sh|iex|invoke-expression|python3?|perl|node)\\b|\\b(?:powershell|pwsh)(?:\\.exe)?\\b[^\\n]{0,60} -(?:e|en|enc|encodedcommand|ec|nop|noprofile|w hidden|windowstyle hidden|ep bypass|exec bypass|executionpolicy bypass)\\b|\\binvoke-expression\\b|\\biex ?\\(|\\| ?iex\\b|\\$\\( ?(?:curl|wget|iwr|irm)\\b|<\\( ?(?:curl|wget)\\b|frombase64string|base64 (?:-d|--decode)[^\\n]*\\| ?(?:ba)?sh|\\bcertutil\\b[^\\n]*-urlcache|\\bbitsadmin\\b[^\\n]*/transfer|\\bmshta (?:https?|vbscript|javascript):|\\bregsvr32\\b[^\\n]*/i:https?|\\brundll32\\b[^\\n]*javascript:|/dev/tcp/|\\bbash -i >&|\\bnc(?:at)? [^\\n]*-e /bin/(?:ba)?sh|\\bset-mppreference\\b[^\\n]*-disable|\\bnet user \\S+ \\S+ /add|\\bschtasks /create|\\bstart-process\\b[^\\n]*-verb runas|\\beval ?\\( ?(?:atob|base64|unescape)`)],
        ['Banco de dados', 'DROP TABLE, DELETE FROM, TRUNCATE, ; --, OR 1=1, UNION SELECT…',
            // como comando (nome + ponto e vírgula ou fim); DELETE sem WHERE ou com WHERE 1=1. Citar "DROP TABLE" passa.
            re(`\\bdrop (?:table|database|schema|user|index|view) (?:if exists )?[\\w."\`\\[\\]]+ ?(?:;|$|--|cascade)|\\bdelete from [\\w."\`\\[\\]]+ ?(?:;|$|--|where (?:1 ?= ?1|true|'1' ?= ?'1')\\b)|\\btruncate table \\S|\\btruncate [\\w."\`\\[\\]]+ ?(?:;|$)|;\\s*--|\\w'\\s*--|'\\s*or\\s+'?1'?\\s*=\\s*'?1|\\bor 1 ?= ?1\\b|\\bunion (?:all )?select\\b|\\bxp_cmdshell\\b|\\balter table \\S+ drop\\b|\\bupdate [\\w."\`\\[\\]]+ set (?:(?!\\bwhere\\b)[^;\\n])*(?:;|$)|\\bgrant all\\b`)],
    ];

    // regras do usuário: {tipo: 'texto'|'regex', v}. Regex inválida fica de fora (não derruba o filtro).
    function compilar(regras) {
        const out = [];
        for (const r of Array.isArray(regras) ? regras : []) {
            if (!r || typeof r.v !== 'string' || !r.v.trim()) continue;
            const nome = 'sua · ' + r.v.slice(0, 40);
            if (r.tipo === 'regex') {
                try { out.push([nome, new RegExp(r.v, 'iu')]); } catch (e) { /* inválida: ignorada */ }
            } else out.push([nome, norm(r.v)]);
        }
        return out;
    }

    // devolve o nome da regra que bate (ou null). `minhas` = compilar(regras do usuário).
    function regra(texto, minhas) {
        const n = norm(texto);
        if (!n) return null;
        for (const [k, , r] of PRONTAS) {
            if (Array.isArray(r) ? r.every((x) => x.test(n)) : r.test(n)) return k;
        }
        for (const [k, r] of minhas || []) {
            if (typeof r === 'string' ? n.includes(r) : (r.test(texto) || r.test(n))) return k;
        }
        return null;
    }

    const valida = (v) => { try { new RegExp(v, 'iu'); return true; } catch (e) { return false; } };

    g.__wlFiltro = { norm, regra, compilar, valida, PRONTAS: PRONTAS.map(([k, mostra]) => ({ k, mostra })) };
})(typeof window !== 'undefined' ? window : globalThis);
