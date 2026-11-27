// ContentPlan — js/auth.js (BARU, PLACEHOLDER — bukan implementasi login)
// ---------------------------------------------------------------------------
// Login & sesi — implementasi penuh ada di draft login terpisah:
//   ~/workspace/contentplan-hardening/login/
//     LOGIN-PLAN.md, LOGIN-EDITS.md, gas/Auth.gs
// File ini SEMENTARA TIDAK mengubah perilaku app: tidak ada gate login aktif,
// bootstrap tetap jalan seperti semula. Saat login diaktifkan, modul ini akan
// berisi login(), logout(), getSessionToken(), isAuthenticated(), dan gate
// di DOMContentLoaded core.js (LOGIN-EDITS.md Edit 4).
// JANGAN aktifkan gate sebelum: (1) akun pertama dibuat (gas/Auth.gs
// createUser — butuh username/password pertama dari Ferry), (2) gas-proxy
// memvalidasi session token. Sampai saat itu, fungsi di bawah ini sengaja
// inert dan TIDAK dipanggil dari mana pun.
// ---------------------------------------------------------------------------

// PLACEHOLDER: selalu true sampai login diaktifkan. Akan diganti oleh
// LOGIN-EDITS.md Edit 4 dengan pengecekan sessionStorage sesungguhnya.
function isAuthenticated() { return true; }
