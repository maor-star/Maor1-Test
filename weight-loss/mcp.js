/**
 * An MCP endpoint over Streamable HTTP, so a bot can answer questions from the site's
 * own content instead of inventing them.
 *
 * Two rules shape everything here. It is read only: there is no tool that writes, so a
 * bot cannot post, edit or delete. And it serves published content only: articles,
 * rules of thumb, slogans and the group's headline numbers. Nothing that identifies a
 * member, and never an email, a weigh-in, a message or a photo.
 */
import db from './db.js';

const PROTOCOL_VERSION = '2025-06-18';

const setting = (key, fallback) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

const TOOLS = [
  {
    name: 'search_articles',
    description:
      'Search the published articles by free text over their title, summary and body. ' +
      'Returns matching articles with a short excerpt. Use this first when asked a ' +
      'nutrition or training question, so the answer comes from the site.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, Hebrew or English.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_articles',
    description: 'List every published article: slug, title, category, summary and reading time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_article',
    description: 'Return one article in full by its slug, for quoting accurately.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
  },
  {
    name: 'get_guidance',
    description:
      "The programme's rules of thumb and the group's slogans, as one-liners.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_program',
    description:
      'How the programme works: the collective target, the number of active members, ' +
      'and the weigh-in schedule. Aggregate only, never an individual.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }],
});

function callTool(name, args = {}) {
  if (name === 'search_articles') {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query is required');
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT slug, title, category, excerpt, author, read_minutes, content
      FROM posts
      WHERE title LIKE ? OR excerpt LIKE ? OR content LIKE ?
      ORDER BY (title LIKE ?) DESC, published_at DESC
      LIMIT ?
    `).all(like, like, like, like, limit);
    return text(rows.map((r) => {
      const at = r.content.indexOf(q);
      const from = Math.max(0, at - 120);
      return {
        slug: r.slug, title: r.title, category: r.category, author: r.author,
        read_minutes: r.read_minutes, excerpt: r.excerpt,
        passage: at === -1 ? r.content.slice(0, 260) : r.content.slice(from, from + 320),
      };
    }));
  }

  if (name === 'list_articles') {
    return text(db.prepare(
      'SELECT slug, title, category, excerpt, author, read_minutes FROM posts ORDER BY published_at DESC, id'
    ).all());
  }

  if (name === 'get_article') {
    const row = db.prepare(
      'SELECT slug, title, category, excerpt, author, read_minutes, content FROM posts WHERE slug = ?'
    ).get(String(args.slug || ''));
    if (!row) throw new Error('article not found');
    return text(row);
  }

  if (name === 'get_guidance') {
    const rows = db.prepare('SELECT text, kind FROM tips ORDER BY kind, position, id').all();
    return text({
      rules: rows.filter((r) => r.kind === 'rule').map((r) => r.text),
      slogans: rows.filter((r) => r.kind === 'slogan').map((r) => r.text),
    });
  }

  if (name === 'get_program') {
    const members = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE active = 1').get().n;
    return text({
      group_goal_kg: Number(setting('group_goal_kg', '200')),
      active_members: members,
      starts_on: '2026-09-01',
      weigh_in: 'Every Tuesday morning, thirteen weeks.',
      daily_targets: ['calories', 'protein', 'one strength session counted weekly'],
      site: 'https://weight.wonderfool.xyz',
      note: 'Educational content. Not medical advice.',
    });
  }

  throw new Error(`unknown tool: ${name}`);
}

/** JSON-RPC 2.0. A request carries an id and expects a reply; a notification has none. */
function handle(message) {
  const { id, method, params } = message || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, msg) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });

  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'easy-weight-loss', version: '1.0.0' },
        instructions:
          'Content from "הדרך הקלה לירידה במשקל". Answer from these articles and quote ' +
          'them; do not invent nutrition claims. Everything here is educational and is ' +
          'not medical advice. No member data is available through this server.',
      });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      try {
        return reply(callTool(name, args));
      } catch (err) {
        // A tool that fails reports through the result, not as a protocol error.
        return reply({ ...text(`error: ${err.message}`), isError: true });
      }
    }
    if (typeof method === 'string' && method.startsWith('notifications/')) return null;
    return fail(-32601, `method not found: ${method}`);
  } catch (err) {
    return fail(-32603, err.message);
  }
}

export function mountMcp(app) {
  const token = process.env.MCP_TOKEN;

  /**
   * The token normally rides in an Authorization header. Some bot builders only let
   * you paste a URL with no way to add headers, so it is also accepted as ?key=.
   * That does put the secret in a URL, and URLs turn up in logs, which is the reason
   * it is the fallback and not the first choice.
   */
  const authorised = (req) => {
    if (!token) return true;
    const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return header === token || req.query.key === token;
  };

  app.post('/mcp', (req, res) => {
    if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });
    const body = req.body;
    // A client may batch several messages into one array.
    if (Array.isArray(body)) {
      const out = body.map(handle).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const out = handle(body);
    if (!out) return res.status(202).end();
    return res.json(out);
  });

  // Some clients open a stream first. There is nothing to push, so this stays open
  // and idle rather than failing the connection.
  app.get('/mcp', (req, res) => {
    if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    req.on('close', () => clearInterval(beat));
  });
}
