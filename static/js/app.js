(function () {
  'use strict';

  var P = window.SongloftPlugin;
  var MAIN_API = '/api/v1';
  var MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

  var parsedStations = [];
  var selectedSet = new Set();
  var playlists = [];
  var targetPlaylistId = 2;

  // DOM
  var fileInput = document.getElementById('fileInput');
  var btnFile = document.getElementById('btn-file');
  var fileName = document.getElementById('file-name');
  var urlInput = document.getElementById('urlInput');
  var btnFetch = document.getElementById('btn-fetch');
  var previewCard = document.getElementById('preview-card');
  var stationCount = document.getElementById('station-count');
  var selectAll = document.getElementById('select-all');
  var selectedInfo = document.getElementById('selected-info');
  var playlistSelect = document.getElementById('playlist-select');
  var btnNewPlaylist = document.getElementById('btn-new-playlist');
  var stationTbody = document.getElementById('station-tbody');
  var btnImport = document.getElementById('btn-import');
  var resultCard = document.getElementById('result-card');
  var resultBody = document.getElementById('result-body');
  var dialogOverlay = document.getElementById('dialogOverlay');
  var dialogCancel = document.getElementById('dialog-cancel');
  var dialogConfirm = document.getElementById('dialog-confirm');
  var newPlaylistName = document.getElementById('new-playlist-name');
  var snackbar = document.getElementById('snackbar');

  // -- Snackbar --
  var snackTimer;
  function showSnack(msg, type) {
    snackbar.textContent = msg;
    snackbar.className = 'snackbar show' + (type ? ' ' + type : '');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(function () {
      snackbar.className = 'snackbar';
    }, 3000);
  }

  // -- Main API helper --
  function mainApiFetch(method, path, body) {
    var token = P.getAuthToken();
    var opts = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(MAIN_API + path, opts).then(function (resp) {
      return resp.text().then(function (text) {
        if (!resp.ok) {
          var msg = 'HTTP ' + resp.status;
          try { var j = JSON.parse(text); msg = j.error || j.message || msg; } catch (e) {}
          throw new Error(msg);
        }
        return text ? JSON.parse(text) : null;
      });
    });
  }

  // -- Init --
  function init() {
    loadPlaylists();
    loadSettings();
  }

  function loadPlaylists() {
    P.apiGet('/api/playlists').then(function (data) {
      playlists = data.playlists || [];
      renderPlaylistSelect();
    }).catch(function () {});
  }

  function loadSettings() {
    P.apiGet('/api/settings').then(function (data) {
      if (data && data.last_playlist_id) {
        targetPlaylistId = data.last_playlist_id;
        playlistSelect.value = String(targetPlaylistId);
      }
    }).catch(function () {});
  }

  function renderPlaylistSelect() {
    playlistSelect.innerHTML = '';
    playlists.forEach(function (pl) {
      var opt = document.createElement('option');
      opt.value = pl.id;
      opt.textContent = pl.name;
      playlistSelect.appendChild(opt);
    });
    playlistSelect.value = String(targetPlaylistId);
  }

  // -- File upload --
  btnFile.addEventListener('click', function () { fileInput.click(); });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;
    fileName.textContent = file.name;

    if (file.size > MAX_FILE_SIZE) {
      showSnack('文件超过 20MB 限制', 'error');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      parseContent(e.target.result);
    };
    reader.onerror = function () {
      showSnack('文件读取失败', 'error');
    };
    reader.readAsText(file);
  });

  // -- URL fetch --
  btnFetch.addEventListener('click', function () {
    var url = urlInput.value.trim();
    if (!url) {
      showSnack('请输入 URL', 'error');
      return;
    }
    btnFetch.disabled = true;
    btnFetch.innerHTML = '<span class="loading"></span>';

    P.apiPost('/api/fetch-url', { url: url }).then(function (data) {
      parseContent(data.content);
    }).catch(function (err) {
      showSnack(err.message || '获取失败', 'error');
    }).finally(function () {
      btnFetch.disabled = false;
      btnFetch.innerHTML = '<span class="material-symbols-outlined">download</span> 获取';
    });
  });

  // Enter key on URL input
  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnFetch.click();
  });

  // -- Parse --
  function parseContent(content) {
    P.apiPost('/api/parse', { content: content }).then(function (data) {
      if (data.errors && data.errors.length > 0 && data.stations.length === 0) {
        showSnack(data.errors[0], 'error');
        return;
      }
      if (data.errors && data.errors.length > 0) {
        showSnack('部分内容解析有问题: ' + data.errors[0]);
      }
      parsedStations = data.stations;
      selectedSet = new Set(parsedStations.map(function (_, i) { return i; }));
      renderPreview();
    }).catch(function (err) {
      showSnack(err.message || '解析失败', 'error');
    });
  }

  // -- Preview --
  function renderPreview() {
    if (parsedStations.length === 0) {
      previewCard.style.display = 'none';
      return;
    }
    previewCard.style.display = '';
    resultCard.style.display = 'none';
    stationCount.textContent = parsedStations.length + ' 个电台';
    selectAll.checked = true;

    stationTbody.innerHTML = '';
    parsedStations.forEach(function (s, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="checkbox" class="cb station-cb" data-idx="' + i + '" checked></td>' +
        '<td><strong>' + escHtml(s.title) + '</strong>' +
          (s.artist ? '<br><small style="color:var(--md-on-surface-variant)">' + escHtml(s.artist) + '</small>' : '') +
        '</td>' +
        '<td><span class="station-url" title="' + escHtml(s.url) + '">' + escHtml(s.url) + '</span></td>' +
        '<td><span class="station-group">' + escHtml(s.group) + '</span></td>';
      stationTbody.appendChild(tr);
    });

    updateSelection();
    bindCheckboxes();
  }

  function bindCheckboxes() {
    var cbs = stationTbody.querySelectorAll('.station-cb');
    cbs.forEach(function (cb) {
      cb.addEventListener('change', function () {
        var idx = parseInt(cb.dataset.idx);
        if (cb.checked) selectedSet.add(idx);
        else selectedSet.delete(idx);
        updateSelection();
      });
    });
  }

  selectAll.addEventListener('change', function () {
    var checked = selectAll.checked;
    var cbs = stationTbody.querySelectorAll('.station-cb');
    cbs.forEach(function (cb) {
      cb.checked = checked;
      var idx = parseInt(cb.dataset.idx);
      if (checked) selectedSet.add(idx);
      else selectedSet.delete(idx);
    });
    updateSelection();
  });

  function updateSelection() {
    var count = selectedSet.size;
    selectedInfo.textContent = '已选 ' + count + ' 个';
    btnImport.disabled = count === 0;
    selectAll.checked = count === parsedStations.length;
  }

  // -- Playlist select --
  playlistSelect.addEventListener('change', function () {
    targetPlaylistId = parseInt(playlistSelect.value);
    P.apiPost('/api/settings', { last_playlist_id: targetPlaylistId }).catch(function () {});
  });

  // -- New playlist dialog --
  btnNewPlaylist.addEventListener('click', function () {
    newPlaylistName.value = '';
    dialogOverlay.style.display = '';
    newPlaylistName.focus();
  });

  dialogCancel.addEventListener('click', function () {
    dialogOverlay.style.display = 'none';
  });

  dialogOverlay.addEventListener('click', function (e) {
    if (e.target === dialogOverlay) dialogOverlay.style.display = 'none';
  });

  dialogConfirm.addEventListener('click', function () {
    var name = newPlaylistName.value.trim();
    if (!name) {
      showSnack('请输入歌单名称', 'error');
      return;
    }
    dialogConfirm.disabled = true;
    mainApiFetch('POST', '/playlists', { name: name, type: 'radio' }).then(function (data) {
      dialogOverlay.style.display = 'none';
      showSnack('歌单已创建');
      playlists.push(data);
      targetPlaylistId = data.id;
      renderPlaylistSelect();
    }).catch(function (err) {
      showSnack(err.message || '创建失败', 'error');
    }).finally(function () {
      dialogConfirm.disabled = false;
    });
  });

  newPlaylistName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') dialogConfirm.click();
  });

  // -- Import --
  btnImport.addEventListener('click', function () {
    var selected = [];
    selectedSet.forEach(function (idx) {
      selected.push(parsedStations[idx]);
    });

    if (selected.length === 0) return;

    btnImport.disabled = true;
    btnImport.innerHTML = '<span class="loading"></span> 导入中...';

    var radios = selected.map(function (s) {
      return { url: s.url, title: s.title, artist: s.artist || '', cover_url: s.logo || '' };
    });

    mainApiFetch('POST', '/songs/radio', radios).then(function (data) {
      var songIds = data.songs.map(function (s) { return s.id; });
      var createdCount = data.count;

      return mainApiFetch('POST', '/playlists/' + targetPlaylistId + '/songs', { song_ids: songIds }).then(function (plData) {
        showResult(createdCount, plData.added || 0, plData.skipped || 0);
      });
    }).catch(function (err) {
      showSnack(err.message || '导入失败', 'error');
    }).finally(function () {
      btnImport.disabled = false;
      btnImport.innerHTML = '<span class="material-symbols-outlined">download</span> 导入选中电台';
    });
  });

  function showResult(created, added, skipped) {
    resultCard.style.display = '';
    var html = '';

    html += '<div class="result-item">';
    html += '<div class="result-icon success"><span class="material-symbols-outlined">check</span></div>';
    html += '<div class="result-text"><span class="result-num">' + created + '</span> 个电台已创建</div>';
    html += '</div>';

    html += '<div class="result-item">';
    html += '<div class="result-icon info"><span class="material-symbols-outlined">playlist_add</span></div>';
    html += '<div class="result-text"><span class="result-num">' + added + '</span> 个已添加到歌单';
    if (skipped > 0) html += '，<span style="color:var(--md-on-surface-variant)">' + skipped + ' 个已跳过（重复）</span>';
    html += '</div></div>';

    resultBody.innerHTML = html;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // -- Util --
  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // -- Boot --
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
