# GB ITU — Portal (gb.mrovere.com)

Portal estático do sistema interno da Gracie Barra Itu. HTML, CSS e JavaScript puro (módulos ES), sem build.
O login é por e-mail e senha (Firebase Authentication); os dados vêm da API em Apps Script, sempre com o token do usuário.
Este repositório é **público**: nada aqui é segredo. A chave web do Firebase e a URL da API são públicas por natureza.

## Desenvolvimento

```bash
npm install
npm run validate     # lint + testes + carimbo de versão + segredos
npm run serve        # http://localhost:8080 (domínio já autorizado no Firebase)
npm run stamp        # recarimba ?v=<hash> nos arquivos; rode antes de commitar mudanças em js/, css/ ou index.html
```

Publicar = mesclar na `main` (GitHub Pages). O cache do Pages é de 10 minutos; o carimbo `?v=` evita servir arquivos misturados.

## SDK do Firebase

Copiado em `vendor/firebase/<versão>/` (versão em `vendor/firebase/VERSION`, SHA-256 em `SHA256SUMS`). Para atualizar:
`bash scripts/vendor-firebase.sh <nova versão>` e teste o login no navegador antes de publicar.
O SDK é iniciado sem o recurso de popup, o que dispensa liberar `apis.google.com` na política de conteúdo.

## Contrato da API

`docs/api-contract.md` (cópia do repositório do servidor). Ao mudar o contrato, atualize os dois repositórios.
