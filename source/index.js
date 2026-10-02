/**
 * LACartoons Source (port desde Kino)
 * getStreams → OK.ru (HLS/MP4), Dhtpre (JWPlayer packer)
 * CubeEmbed requiere kino.crypto + secret (omitido en LOL; se intenta URL directa)
 */
var BASE = 'https://www.lacartoons.com';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url, extraHeaders) {
  var h = Object.assign(
    {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'es-MX,es;q=0.9',
      Referer: BASE + '/',
    },
    extraHeaders || {}
  );
  var res = await fetch(url, { headers: h, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

function absolute(url) {
  try {
    return new URL(url, BASE).toString();
  } catch (e) {
    return url;
  }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function streamObj(url, quality, name, headers) {
  if (!url) return null;
  var u = String(url);
  var isHls = /\.m3u8(\?|$)/i.test(u) || /hls/i.test(u);
  var isMp4 = /\.mp4(\?|$)/i.test(u);
  var n = name || 'LACartoons';
  return {
    url: u,
    quality: quality || (isHls ? 'HLS' : isMp4 ? 'MP4' : 'HD'),
    name: n,
    title: n + (quality ? ' · ' + quality : ''),
    provider: 'LACartoons',
    type: isHls ? 'hls' : isMp4 ? 'mp4' : 'url',
    isHls: isHls,
    headers: headers || { 'User-Agent': UA, Referer: BASE + '/' },
  };
}

/* ─── OK.ru ─────────────────────────────────────────────── */

function metadataFromEmbed(html) {
  var attr = /data-options\s*=\s*(["'])([\s\S]*?)\1/i.exec(html);
  if (attr) {
    try {
      var player = JSON.parse(decodeEntities(attr[2]));
      var raw =
        player && player.flashvars && player.flashvars.metadata;
      if (raw) {
        return typeof raw === 'string'
          ? JSON.parse(decodeEntities(raw))
          : raw;
      }
    } catch (e) {}
  }
  var marker =
    /[&\"]?metadata[&\"]?\s*[:=]\s*["']((?:\\.|[^"'])+)["']/i.exec(html);
  if (marker) {
    try {
      return JSON.parse(decodeEntities(marker[1]));
    } catch (e) {}
  }
  return null;
}

function firstPlayableVideo(metadata) {
  var videos =
    metadata && Array.isArray(metadata.videos) ? metadata.videos : [];
  var ranked = videos.slice().sort(function (a, b) {
    return Number(b.width || 0) - Number(a.width || 0);
  });
  for (var i = 0; i < ranked.length; i++) {
    var v = ranked[i];
    if (typeof v.url === 'string' && /^https:\/\//i.test(v.url)) return v;
  }
  return null;
}

async function resolveOkRu(embedUrl) {
  var embedHtml = await fetchHtml(embedUrl, { Referer: BASE + '/' });
  var metadata = metadataFromEmbed(embedHtml);
  if (!metadata) return [];

  var out = [];
  var hls =
    metadata.hlsMasterPlaylistUrl ||
    metadata.hlsMasterUrl ||
    metadata.hlsManifestUrl;
  if (typeof hls === 'string' && /^https?:\/\//i.test(hls)) {
    var s = streamObj(hls, 'HLS', 'OK.ru HLS', {
      'User-Agent': UA,
      Referer: 'https://ok.ru/',
    });
    if (s) out.push(s);
  }

  var video = firstPlayableVideo(metadata);
  if (video && video.url) {
    var q =
      video.width >= 1920
        ? '1080p'
        : video.width >= 1280
          ? '720p'
          : video.width >= 854
            ? '480p'
            : '360p';
    var s2 = streamObj(video.url, q, 'OK.ru ' + q, {
      'User-Agent': UA,
      Referer: 'https://ok.ru/',
    });
    if (s2) out.push(s2);
  }

  // Otras calidades del array
  var videos = Array.isArray(metadata.videos) ? metadata.videos : [];
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i];
    if (!v || typeof v.url !== 'string') continue;
    if (!/^https:\/\//i.test(v.url)) continue;
    var already = out.some(function (x) {
      return x.url === v.url;
    });
    if (already) continue;
    var qq =
      v.width >= 1920
        ? '1080p'
        : v.width >= 1280
          ? '720p'
          : v.width >= 854
            ? '480p'
            : 'SD';
    var s3 = streamObj(v.url, qq, 'OK.ru ' + qq, {
      'User-Agent': UA,
      Referer: 'https://ok.ru/',
    });
    if (s3) out.push(s3);
  }
  return out;
}

/* ─── Dhtpre (JWPlayer packer) ──────────────────────────── */

function unpackPacker(script) {
  var m =
    /}\s*\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\'|[^'])*)'\s*\.split\('\|'\)/.exec(
      script
    );
  if (!m) return null;
  var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  var a = parseInt(m[2], 10);
  var c = parseInt(m[3], 10);
  var k = m[4].split('|');
  var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function unbase(s) {
    var r = 0;
    for (var i = 0; i < s.length; i++) {
      var pos = chars.indexOf(s.charAt(i));
      if (pos < 0 || pos >= a) return NaN;
      r = r * a + pos;
    }
    return r;
  }
  return p.replace(/\b\w+\b/g, function (tok) {
    var idx = unbase(tok);
    if (isNaN(idx) || idx >= k.length) return tok;
    return k[idx] ? k[idx] : tok;
  });
}

async function resolveDhtpre(embedUrl) {
  var html = await fetchHtml(embedUrl, { Referer: BASE + '/' });
  var out = [];
  // URLs directas en HTML
  var direct = html.match(/https?:\/\/[^"'\\s]+\.(?:m3u8|mp4)[^"'\\s]*/gi) || [];
  for (var i = 0; i < direct.length; i++) {
    var u = direct[i].replace(/\\u0026/g, '&');
    var s = streamObj(u, /\.m3u8/i.test(u) ? 'HLS' : 'MP4', 'Dhtpre', {
      'User-Agent': UA,
      Referer: embedUrl,
    });
    if (s) out.push(s);
  }
  // Packer scripts
  var scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (var j = 0; j < scripts.length; j++) {
    var body = scripts[j].replace(/<\/?script[^>]*>/gi, '');
    if (body.indexOf('eval(function(p,a,c,k') < 0 && body.indexOf('}(') < 0)
      continue;
    var unpacked = unpackPacker(body);
    if (!unpacked) continue;
    var urls =
      unpacked.match(/https?:\/\/[^"'\\s]+\.(?:m3u8|mp4)[^"'\\s]*/gi) || [];
    for (var k = 0; k < urls.length; k++) {
      var uu = urls[k].replace(/\\u0026/g, '&');
      var already = out.some(function (x) {
        return x.url === uu;
      });
      if (already) continue;
      var ss = streamObj(uu, /\.m3u8/i.test(uu) ? 'HLS' : 'MP4', 'Dhtpre', {
        'User-Agent': UA,
        Referer: embedUrl,
      });
      if (ss) out.push(ss);
    }
    // file: "..."
    var fileM = /file\s*:\s*["']([^"']+)["']/i.exec(unpacked);
    if (fileM) {
      var fu = fileM[1];
      if (!/^https?:\/\//i.test(fu)) fu = absolute(fu);
      var sf = streamObj(fu, /\.m3u8/i.test(fu) ? 'HLS' : 'MP4', 'Dhtpre', {
        'User-Agent': UA,
        Referer: embedUrl,
      });
      if (sf) out.push(sf);
    }
  }
  return out;
}

/* ─── Episode page → embed ──────────────────────────────── */

async function streamsFromEpisodePage(episodeUrl) {
  var html = await fetchHtml(episodeUrl);
  var embeds = [];
  var seenE = {};
  var iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
  var im;
  while ((im = iframeRe.exec(html)) !== null) {
    var eu = absolute(im[1]);
    if (!seenE[eu]) {
      seenE[eu] = true;
      embeds.push(eu);
    }
  }
  var other =
    html.match(
      /https?:\/\/(?:[\w.-]*\.)?(?:ok\.ru|odnoklassniki\.ru|dhtpre\.com|cubeembed\.rpmvid\.com)[^"'\s]*/gi
    ) || [];
  for (var oi = 0; oi < other.length; oi++) {
    var ou = other[oi].replace(/&amp;/g, '&');
    if (!seenE[ou]) {
      seenE[ou] = true;
      embeds.push(ou);
    }
  }

  var vsrc = /<video[^>]+src=["']([^"']+)["']/i.exec(html);
  if (vsrc) {
    var vs = streamObj(absolute(vsrc[1]), null, 'Video', {
      'User-Agent': UA,
      Referer: episodeUrl,
    });
    if (vs) return [vs];
  }

  if (!embeds.length) return [];

  var all = [];
  for (var ei = 0; ei < embeds.length; ei++) {
    var embedUrl = embeds[ei];
    var hostname = '';
    try {
      hostname = new URL(embedUrl).hostname.toLowerCase();
    } catch (e) {
      continue;
    }

    try {
      if (
        hostname === 'ok.ru' ||
        hostname.indexOf('.ok.ru') >= 0 ||
        hostname.indexOf('odnoklassniki') >= 0
      ) {
        var ok = await resolveOkRu(embedUrl);
        for (var a = 0; a < ok.length; a++) all.push(ok[a]);
        continue;
      }
      if (hostname === 'dhtpre.com' || hostname.indexOf('.dhtpre.com') >= 0) {
        var dh = await resolveDhtpre(embedUrl);
        for (var b = 0; b < dh.length; b++) all.push(dh[b]);
        continue;
      }
      if (
        hostname.indexOf('cubeembed') >= 0 ||
        hostname.indexOf('rpmvid') >= 0
      ) {
        var ch = await fetchHtml(embedUrl, { Referer: BASE + '/' });
        var found =
          ch.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/gi) || [];
        for (var c = 0; c < found.length; c++) {
          var s = streamObj(
            found[c].replace(/\\u0026/g, '&'),
            /\.m3u8/i.test(found[c]) ? 'HLS' : 'MP4',
            'CubeEmbed',
            { 'User-Agent': UA, Referer: embedUrl }
          );
          if (s) all.push(s);
        }
        continue;
      }
      // genérico
      var gh = await fetchHtml(embedUrl, { Referer: BASE + '/' });
      var gfound =
        gh.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/gi) || [];
      for (var d = 0; d < gfound.length; d++) {
        var s2 = streamObj(
          gfound[d].replace(/\\u0026/g, '&'),
          /\.m3u8/i.test(gfound[d]) ? 'HLS' : 'MP4',
          hostname,
          { 'User-Agent': UA, Referer: embedUrl }
        );
        if (s2) all.push(s2);
      }
    } catch (e) {}
  }
  return all;
}

function resolveEpisodeUrl(tmdbId, season, episode) {
  if (!tmdbId) return null;
  var raw = String(tmdbId).trim();

  // Ya es URL de capítulo
  if (/lacartoons\.com/i.test(raw) && /capitulo/i.test(raw)) {
    return raw;
  }
  // Cualquier URL http de lacartoons (capítulo u otra)
  if (/^https?:\/\//i.test(raw) && /lacartoons\.com/i.test(raw)) {
    return raw;
  }
  // URL genérica http
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return null;
}

async function getStreams(tmdbId, type, season, episode) {
  // Compat: a veces llega un objeto
  if (tmdbId && typeof tmdbId === 'object') {
    var o = tmdbId;
    tmdbId =
      o.tmdbId ||
      o.url_personalizada ||
      o.lacartoonsUrl ||
      o.url ||
      o.id ||
      '';
    type = type || o.type;
    season = season != null ? season : o.season;
    episode = episode != null ? episode : o.episode;
  }

  var episodeUrl = resolveEpisodeUrl(tmdbId, season, episode);
  if (!episodeUrl) {
    return [];
  }

  // Página de serie sin capítulo → no hay stream único
  if (/\/serie\//i.test(episodeUrl) && !/capitulo/i.test(episodeUrl)) {
    return [];
  }

  try {
    var streams = await streamsFromEpisodePage(episodeUrl);
    var seen = {};
    var unique = [];
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (!s || !s.url || seen[s.url]) continue;
      seen[s.url] = true;
      // Campos que la app espera
      if (!s.title) s.title = s.name || 'LACartoons';
      if (!s.provider) s.provider = 'LACartoons';
      unique.push(s);
    }
    // Array directo (JsRuntime) o {streams}
    return unique;
  } catch (e) {
    return [];
  }
}

module.exports = {
  getStreams: getStreams,
};
