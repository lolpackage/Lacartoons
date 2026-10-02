/**
 * LACartoons Catalog (port desde Kino plugin)
 * getHome / search / discover / getMeta
 */
var BASE = 'https://www.lacartoons.com';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var HOME_SIZE = 20;
var HOME_CATEGORIES = 4;

async function fetchHtml(url) {
  var res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      Referer: BASE + '/',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' → ' + url);
  return await res.text();
}

function absolute(url) {
  try {
    return new URL(url, BASE).toString();
  } catch (e) {
    return url;
  }
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(text) {
  return decodeHtml(String(text || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  var s = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return s || 'serie';
}

function seriesId(url, title) {
  var m = /\/serie\/([^/?#]+)/i.exec(url);
  return 'lacartoons:series:' + (m ? slug(m[1]) : slug(title));
}

function mapItem(raw) {
  return {
    id: raw.id,
    title: raw.title,
    type: 'series',
    poster: raw.poster || null,
    backdrop: raw.poster || null,
    year: raw.year ? parseInt(String(raw.year).slice(0, 4), 10) : null,
    overview: '',
    genres: ['Animación'],
    extra: {
      source: 'lacartoons',
      lacartoonsUrl: raw.ref,
      mediaType: 'tv',
    },
  };
}

function parseSeriesCards(html) {
  var out = [];
  var seen = {};
  var re =
    /a\s+href="(\/serie[^"]+)"[\s\S]*?src="([^"]+)"[\s\S]*?nombre-serie">([\s\S]*?)<\/p>[\s\S]*?class="marcador marcador-ano">([\s\S]*?)<\/span>/gi;
  var m;
  while ((m = re.exec(html)) !== null && out.length < 100) {
    var url = absolute(decodeHtml(m[1]));
    var title = stripTags(m[3]);
    var year = stripTags(m[4]);
    var id = seriesId(url, title);
    if (seen[id] || !title) continue;
    seen[id] = true;
    out.push({
      id: id,
      ref: url,
      title: title,
      year: year || undefined,
      poster: absolute(decodeHtml(m[2])),
    });
  }
  return out;
}

function parseCategoryLinks(html) {
  var out = [];
  var re =
    /<button[^>]*type="submit"[^>]*>\s*([^<]+?)\s*<\/button>[\s\S]*?value="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null && out.length < 20) {
    var title = stripTags(m[1]);
    var id = String(m[2]).trim();
    if (title && id) {
      out.push({
        id: 'cat-' + slug(id),
        title: title,
        url: BASE + '/?categoria_id=' + encodeURIComponent(id),
      });
    }
  }
  return out;
}

function pageUrl(page) {
  return page <= 1 ? BASE + '/' : BASE + '/?page=' + page;
}

async function getHome(args, config) {
  var html = await fetchHtml(BASE + '/');
  var rows = [];
  var all = parseSeriesCards(html);
  if (all.length) {
    rows.push({
      id: 'lacartoons-series',
      title: 'Series LACartoons',
      items: all.slice(0, HOME_SIZE).map(mapItem),
    });
  }
  var categories = parseCategoryLinks(html).slice(0, HOME_CATEGORIES);
  for (var i = 0; i < categories.length; i++) {
    try {
      var catHtml = await fetchHtml(categories[i].url);
      var items = parseSeriesCards(catHtml).slice(0, HOME_SIZE).map(mapItem);
      if (items.length) {
        rows.push({
          id: categories[i].id,
          title: categories[i].title,
          items: items,
        });
      }
    } catch (e) {}
  }
  return { rows: rows };
}

async function search(args, config) {
  var q = ((args && (args.q || args.query)) || '').toString().trim();
  if (!q) return { items: [] };
  var url =
    BASE +
    '/?utf8=%E2%9C%93&Titulo=' +
    encodeURIComponent(q) +
    '&button=';
  var html = await fetchHtml(url);
  return { items: parseSeriesCards(html).slice(0, 100).map(mapItem) };
}

async function discover(args, config) {
  var page = (args && args.page) || 1;
  var genero = (args && (args.genero || args.genre || args.genreId)) || null;
  var url = pageUrl(page);
  // Si genero es un id de categoría numérico/slug cat-
  if (genero && String(genero) !== 'todas') {
    var g = String(genero).replace(/^cat-/, '');
    url = BASE + '/?categoria_id=' + encodeURIComponent(g);
    if (page > 1) url += '&page=' + page;
  }
  var html = await fetchHtml(url);
  var items = parseSeriesCards(html).map(mapItem);
  return {
    items: items,
    page: page,
    hasNext: items.length >= 20,
  };
}

function parseEpisodes(html, seriesUrl) {
  var episodes = [];
  var blockRe =
    /(?:fa\s+fa-chevron-right[^>]*><\/span>\s*)?Temporada\s+(\d+)([\s\S]*?)(?=(?:fa\s+fa-chevron-right[^>]*><\/span>\s*)?Temporada\s+\d+|Series recomendadas|<\/body>|$)/gi;
  var b;
  while ((b = blockRe.exec(html)) !== null) {
    var season = Number(b[1]);
    var blockHtml = b[2];
    var re =
      /href="([^"]*\/serie\/capitulo\/[^"]+)"[\s\S]*?<span>([^<]*)<\/span>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(blockHtml)) !== null && episodes.length < 5000) {
      var url = absolute(decodeHtml(m[1]));
      var cap = stripTags(m[2]);
      var body = stripTags(m[3]);
      var n = /Capitulo\s+(\d+)/i.exec(cap);
      var number = n ? Number(n[1]) : 0;
      if (!number) continue;
      var title =
        season +
        'x' +
        number +
        (body ? ' · ' + body.replace(/Capitulo\s+\d+/i, '').trim() : '');
      episodes.push({
        id: seriesId(seriesUrl, '') + ':s' + season + 'e' + number,
        title: title || 'Capítulo ' + number,
        season: season,
        episode: number,
        url: url,
      });
    }
  }
  return episodes;
}

async function getMeta(args, config) {
  var id = (args && args.id) || '';
  var url = null;
  if (args && args.extra && args.extra.lacartoonsUrl) {
    url = args.extra.lacartoonsUrl;
  }
  if (!url && id.indexOf('lacartoons:') === 0) {
    // buscar slug en id
    var parts = String(id).split(':');
    var slugPart = parts[parts.length - 1];
    if (slugPart && slugPart.indexOf('s') !== 0) {
      url = BASE + '/serie/' + slugPart;
    }
  }
  if (!url) {
    return {
      item: {
        id: id,
        title: id,
        type: 'series',
        overview: '',
        poster: null,
        genres: [],
        extra: { source: 'lacartoons' },
      },
    };
  }

  var html = await fetchHtml(url);
  var titleMatch =
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
    /property="og:title"[^>]+content="([^"]+)"/i.exec(html);
  var title = titleMatch ? stripTags(titleMatch[1]) : slug(url);
  var posterMatch =
    /property="og:image"[^>]+content="([^"]+)"/i.exec(html) ||
    /<img[^>]+src="([^"]+)"/i.exec(html);
  var poster = posterMatch ? absolute(decodeHtml(posterMatch[1])) : null;
  var episodes = parseEpisodes(html, url);

  // Agrupar en seasons para la app
  var seasonsMap = {};
  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];
    var s = String(ep.season);
    if (!seasonsMap[s]) seasonsMap[s] = [];
    seasonsMap[s].push({
      id: ep.id,
      title: ep.title,
      season: ep.season,
      episode: ep.episode,
      still: poster,
      extra: {
        lacartoonsUrl: ep.url,
        source: 'lacartoons',
      },
    });
  }
  var seasons = Object.keys(seasonsMap)
    .sort(function (a, b) {
      return Number(a) - Number(b);
    })
    .map(function (s) {
      return { season: Number(s), episodes: seasonsMap[s] };
    });

  return {
    item: {
      id: seriesId(url, title),
      title: title,
      type: 'series',
      poster: poster,
      backdrop: poster,
      overview: '',
      genres: ['Animación'],
      extra: {
        source: 'lacartoons',
        lacartoonsUrl: url,
        mediaType: 'tv',
        seasons: seasons,
      },
      seasons: seasons,
    },
  };
}

module.exports = {
  getHome: getHome,
  search: search,
  discover: discover,
  getMeta: getMeta,
};
