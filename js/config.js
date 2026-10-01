// Valores públicos por natureza: a chave web do Firebase não é segredo (a proteção é o token validado no servidor)
// e a URL do /exec é pública. Só este arquivo pode conter a chave AIza… e a URL da API.
export const CONFIG = Object.freeze({
  apiUrl: 'https://script.google.com/macros/s/AKfycbxP1UjnBJ-o0IGH4QMVUnJzgogzzUsHnpvi_zZ8jN4rOPDs9YOhRwo73LaWwR-GkeOI/exec',
  firebase: Object.freeze({
    apiKey: 'AIzaSyCj_xIye9k6epTU_lb9wRGvAPoSM5eDDZY',
    authDomain: 'gb-itu.firebaseapp.com',
    projectId: 'gb-itu',
    appId: '1:666300265300:web:52b0c3fe8c4bebd1c18ec1',
  }),
  idleLogoutMs: 30 * 60 * 1000,
  requestTimeoutMs: 30000,
});
