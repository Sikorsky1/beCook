// OpenAI simulado para el E2E (P35). Solo node:http, solo 127.0.0.1, sin dependencias.
// Atiende /v1/chat/completions y /v1/responses y responde según el nombre del esquema JSON
// con datos fijos (fixtures/openai-responses.json) y un consumo de tokens, para que el
// registro de uso de IA guarde coste como en producción. Nunca reenvía nada a OpenAI.
const http = require("node:http");
const fixtures = require("./fixtures/openai-responses.json");

const HOST = "127.0.0.1";
const MAX_BODY = 1024 * 1024;

function pickDishes(preferred, catalog, used, count) {
  const chosen = [];
  for (const name of [...preferred.filter(dish => catalog.has(dish)), ...catalog]) {
    if (chosen.length === count) break;
    if (!used.has(name)) { used.add(name); chosen.push(name); }
  }
  return chosen;
}

// menu_selection: siete comidas y siete cenas válidas del catálogo que manda la petición.
function menuSelection(body) {
  const user = (body.messages ?? []).find(message => message.role === "user");
  let examples = [];
  try { examples = JSON.parse(user?.content ?? "{}").nutritionistExamples ?? []; } catch { examples = []; }
  const catalog = new Set(examples.filter(name => typeof name === "string"));
  const used = new Set();
  const lunches = pickDishes(fixtures.menuSelection.lunches, catalog, used, 7);
  const dinners = pickDishes(fixtures.menuSelection.dinners, catalog, used, 7);
  return { lunches, dinners };
}

// shopping_list_by_dish: los mismos artículos para cada comida planificada de la semana recibida.
function plannedMeals(input) {
  // The week JSON comes first; the optional household restrictions follow after a blank line.
  const start = input.indexOf("[");
  const restrictions = input.indexOf("\n\nRestricciones", start);
  let week = [];
  try { week = JSON.parse(input.slice(start, restrictions === -1 ? undefined : restrictions)); } catch { week = []; }
  const meals = [];
  for (const day of Array.isArray(week) ? week : []) {
    for (const meal of ["lunch", "dinner"]) {
      const slot = day?.[meal];
      const free = slot === "LIBRE" || slot?.status === "free" || !slot;
      if (!free) meals.push({ day: day.day, meal });
    }
  }
  return meals;
}

function chatContent(schema, body) {
  if (schema === "menu_selection") return menuSelection(body);
  if (schema === "dish_substitution") return fixtures.dishSubstitution;
  if (schema === "imported_menu") return fixtures.importedMenu;
  return null;
}

function responsesContent(schema, body) {
  if (schema === "dish_card") return fixtures.dishCard;
  const meals = plannedMeals(String(body.input ?? ""));
  if (schema === "shopping_list_by_dish") {
    return { dishes: meals.map(({ day, meal }) => ({ day, meal, items: fixtures.shoppingByMeal[meal] })) };
  }
  if (schema === "shopping_list") return { items: [...fixtures.shoppingByMeal.lunch, ...fixtures.shoppingByMeal.dinner] };
  return null;
}

function send(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function createMockOpenAI() {
  const calls = {};
  const count = name => { calls[name] = (calls[name] ?? 0) + 1; };
  const { promptTokens, completionTokens } = fixtures.usage;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__health") return send(res, 200, { ok: true, calls });
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(res, 400, { error: { message: "invalid json" } }); }
      const model = typeof body.model === "string" ? body.model : "gpt-5.6-sol";
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const schema = body.response_format?.json_schema?.name;
        const content = chatContent(schema, body);
        count(schema ?? "unknown_chat");
        if (!content) return send(res, 400, { error: { message: "unknown schema", type: "invalid_request_error" } });
        return send(res, 200, {
          id: "chatcmpl-e2e", object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content), refusal: null } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        });
      }
      if (req.method === "POST" && req.url === "/v1/responses") {
        const schema = body.text?.format?.name;
        const content = responsesContent(schema, body);
        count(schema ?? "unknown_response");
        if (!content) return send(res, 400, { error: { message: "unknown schema", type: "invalid_request_error" } });
        return send(res, 200, {
          id: "resp_e2e", object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model,
          output: [{ type: "message", id: "msg_e2e", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(content), annotations: [] }] }],
          usage: { input_tokens: promptTokens, output_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        });
      }
      send(res, 404, { error: { message: "not found" } });
    });
  });

  return {
    calls,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => resolve(`http://${HOST}:${server.address().port}/v1`));
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

module.exports = { createMockOpenAI, menuSelection, plannedMeals };

if (require.main === module) {
  const port = Number(process.env.E2E_MOCK_PORT ?? 4010);
  createMockOpenAI().listen(port).then(url => console.log(`OpenAI simulado en ${url}`));
}
