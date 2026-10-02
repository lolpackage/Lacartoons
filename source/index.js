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
  return {
    url: u,
    quality: quality || (isHls ? 'HLS' : isMp4 ? 'MP4' : 'HD'),
    name: name || 'LACartoons',
    type: isHls ? 'hls' : isMp4 ? 'mp4' : 'url',
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
  var iframe = /<iframe[^>]+src="([^"]+)"/i.exec(html);
  if (!iframe) return [];
  var embedUrl = absolute(iframe[1]);
  var hostname = '';
  try {
    hostname = new URL(embedUrl).hostname.toLowerCase();
  } catch (e) {
    return [];
  }

  if (
    hostname === 'ok.ru' ||
    hostname.indexOf('.ok.ru') >= 0 ||
    hostname.indexOf('odnoklassniki') >= 0
  ) {
    return await resolveOkRu(embedUrl);
  }
  if (hostname === 'dhtpre.com' || hostname.indexOf('.dhtpre.com') >= 0) {
    return await resolveDhtpre(embedUrl);
  }
  // CubeEmbed u otros: devolver embed como último recurso no ayuda al player;
  // intentar extraer m3u8/mp4 del HTML del embed
  if (
    hostname.indexOf('cubeembed') >= 0 ||
    hostname.indexOf('rpmvid') >= 0
  ) {
    try {
      var ch = await fetchHtml(embedUrl, { Referer: BASE + '/' });
      var found =
        ch.match(/https?:\/\/[^"'\\s]+\.(?:m3u8|mp4)[^"'\\s]*/gi) || [];
      var out = [];
      for (var i = 0; i < found.length; i++) {
        var s = streamObj(
          found[i].replace(/\\u0026/g, '&'),
          /\.m3u8/i.test(found[i]) ? 'HLS' : 'MP4',
          'CubeEmbed',
          { 'User-Agent': UA, Referer: embedUrl }
        );
        if (s) out.push(s);
      }
      return out;
    } catch (e) {
      return [];
    }
  }
  // generico
  try {
    var gh = await fetchHtml(embedUrl, { Referer: BASE + '/' });
    var gfound =
      gh.match(/https?:\/\/[^"'\\s]+\.(?:m3u8|mp4)[^"'\\s]*/gi) || [];
    return gfound
      .map(function (u) {
        return streamObj(u.replace(/\\u0026/g, '&'), /\.m3u8/i.test(u) ? 'HLS' : 'MP4', hostname, {
          'User-Agent': UA,
          Referer: embedUrl,
        });
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function pickEpisodeUrl(args) {
  if (!args) return null;
  if (args.url && /lacartoons\.com/i.test(args.url)) return args.url;
  if (args.extra) {
    if (args.extra.lacartoonsUrl) return args.extra.lacartoonsUrl;
    if (args.extra.url) return args.extra.url;
  }
  if (args.episode && args.episode.extra && args.episode.extra.lacartoonsUrl) {
    return args.episode.extra.lacartoonsUrl;
  }
  // a veces id es la URL
  if (args.id && /^https?:\/\//i.test(String(args.id))) return String(args.id);
  return null;
}

/**
 * getStreams({ id, type, title, season, episode, extra, url })
 */
async function getStreams(args, config) {
  var episodeUrl = pickEpisodeUrl(args);

  // Si no hay URL de capítulo, intentar página de serie + season/episode
  if (!episodeUrl && args) {
    var seriesUrl =
      (args.extra && args.extra.lacartoonsUrl) ||
      (args.seriesUrl) ||
      null;
    if (seriesUrl && args.season != null && args.episode != null) {
      // La URL real de capítulo suele ser /serie/capitulo/...; sin slug exacto
      // reutilizamos getMeta no disponible aquí → fallar limpio
    }
  }

  if (!episodeUrl) {
    return { streams: [] };
  }

  // Si es página de serie (no capítulo), no hay un solo stream
  if (/\/serie\//i.test(episodeUrl) && !/capitulo/i.test(episodeUrl)) {
    return { streams: [] };
  }

  try {
    var streams = await streamsFromEpisodePage(episodeUrl);
    // dedupe
    var seen = {};
    var unique = [];
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (!s || !s.url || seen[s.url]) continue;
      seen[s.url] = true;
      unique.push(s);
    }
    return { streams: unique };
  } catch (e) {
    return { streams: [] };
  }
}

module.exports = {
  getStreams: getStreams,
};
