# Spore Shop · Playtest Observatory

Painel público de playtests. O código e os assets do jogo ficam em outro repositório. As métricas permanecem em Google Sheets privado e a leitura exige READ_TOKEN, mantido somente na memória da aba.

## Abrir localmente

No Windows, abra Iniciar painel.cmd. Com Node.js: node scripts/serve.mjs. Acesse http://127.0.0.1:4173 e configure a URL /exec do Apps Script e READ_TOKEN, ou explore a demonstração fictícia.

## Publicação

O workflow publica GitHub Pages automaticamente após push em main. node scripts/package-site.mjs gera dist com somente os arquivos públicos. Backend, testes e arquivos locais não entram na hospedagem estática. Nunca adicione chaves ou dados reais ao repositório.

## Apps Script

O receptor está em api/apps-script: Code.gs, Bridge.html e appsscript.json. Execute setupPlaytest no editor e publique como aplicativo web executando como Eu, acesso Qualquer pessoa. A planilha continua com compartilhamento Restrito. INGEST_TOKEN é exclusivo do jogo; READ_TOKEN é exclusivo do painel. ALLOWED_ORIGINS inclui https://gabreusenra.github.io.

A implantação Google existente continua sendo usada. Este repositório mantém a mesma origem gabreusenra.github.io, sem exigir trocar credenciais.

## Manutenção

Execute node --test tests/*.test.mjs. Os testes usam o código real do Apps Script com serviços Google emulados.

catalog.json é exportado da árvore do jogo. No checkout privado do jogo, execute node tools/playtest/export-catalog.mjs CAMINHO_DESTE_REPOSITORIO/catalog.json e faça commit do resultado neste repositório. Scripts Godot e configuração de envio permanecem no jogo.

O teste HTTP opcional usa node scripts/test-godot-http.mjs CAMINHO_DO_GODOT CAMINHO_DO_JOGO, com receptor local temporário e armazenamento Google emulado.
