// 讓同一份網頁（src/Index.html、Report.html）在 Vercel 上執行：
// 把 google.script.run.xxx(...) 轉成呼叫 /api/call（檔案上傳走 /api/upload）
(function () {
  window.__VERCEL__ = true;
  var UPLOAD = { api_uploadPhoto: 1, api_publicUpload: 1, api_uploadFile: 1, api_uploadPunch: 1 };
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, fn) {
        if (fn === 'withSuccessHandler') return function (h) { return runner(h, fail); };
        if (fn === 'withFailureHandler') return function (h) { return runner(ok, h); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch(UPLOAD[fn] ? '/api/upload' : '/api/call', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args })
          }).then(function (r) {
            return r.json().catch(function () { throw new Error(r.status === 413 ? '檔案太大' : '伺服器回應錯誤（' + r.status + '）'); });
          }).then(function (j) {
            if (j.error) throw new Error(j.error);
            if (ok) ok(j.result);
          }).catch(function (e) {
            var err = e instanceof Error ? e : new Error(String(e));
            if (/Failed to fetch|NetworkError|Load failed/.test(err.message)) err = new Error('網路連線失敗，請稍後再試');
            if (fail) fail(err);
          });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };
})();
