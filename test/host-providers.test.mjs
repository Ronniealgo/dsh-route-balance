import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, readBalances, createCredentialResolver } from "../lib/index.js";

const DEEPSEEK_ANSWER = {
  is_available: true,
  balance_infos: [{ currency: "CNY", total_balance: "12.11", granted_balance: "0.00", topped_up_balance: "12.11" }],
};

function fakeFetch(routes) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, init) {
      calls.push({ url: String(url), init });
      const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
      if (hit === undefined) return { ok: false, status: 404, async json() { return {}; } };
      return { ok: hit[1].status >= 200 && hit[1].status < 300, status: hit[1].status, async json() { return hit[1].body; } };
    },
  };
}

function creds(map) {
  const asked = [];
  return { asked, async resolve(name) { asked.push(name); return map[name] === undefined ? undefined : { value: map[name] }; } };
}

test("host: the DeepSeek API-key route reads the official balance endpoint", async () => {
  const credentials = creds({ DEEPSEEK_API_KEY: "sk-deepseek-test" });
  const { fetchImpl, calls } = fakeFetch({ "https://api.deepseek.com/user/balance": { status: 200, body: DEEPSEEK_ANSWER } });
  const payload = await readBalances({ credentials, config: {}, fetchImpl, providers: PROVIDERS });
  const entry = payload.entries.find((candidate) => candidate.id === "deepseek-official");
  assert.equal(entry.kind, "ready");
  assert.deepEqual(entry.amounts, [{ currency: "CNY", text: "¥12.11" }]);
  assert.match(entry.detail, /充值 12.11/);
  assert.equal(calls[0].init.headers.authorization, "Bearer sk-deepseek-test");
});

test("host: a DeepSeek answer without balance_infos is a failure, not a zero", async () => {
  const credentials = creds({ DEEPSEEK_API_KEY: "sk-deepseek-test" });
  const { fetchImpl } = fakeFetch({ "https://api.deepseek.com/user/balance": { status: 200, body: { is_available: true } } });
  const payload = await readBalances({ credentials, config: {}, fetchImpl, providers: PROVIDERS });
  const entry = payload.entries.find((candidate) => candidate.id === "deepseek-official");
  assert.equal(entry.kind, "failed");
  assert.ok(entry.amounts === null || entry.amounts.length === 0, "no amount is invented");
});

test("host: MiMo tries its candidates and reports 'no usage endpoint' when all 404", async () => {
  const credentials = creds({ MIMO_TOKEN_PLAN_API_KEY: "mimo-test" });
  const { fetchImpl, calls } = fakeFetch({});
  const payload = await readBalances({ credentials, config: {}, fetchImpl, providers: PROVIDERS });
  const entry = payload.entries.find((candidate) => candidate.id === "xiaomi-mimo");
  assert.equal(entry.kind, "unavailable");
  assert.match(entry.detail, /当前探测的用量接口不可用/);
  assert.ok(calls.some((call) => call.url.includes("xiaomimimo.com")), "the token-plan origin is actually probed");
});

test("host: MiMo adopts a usage answer if the provider ever exposes one", async () => {
  const credentials = creds({ MIMO_TOKEN_PLAN_API_KEY: "mimo-test" });
  const { fetchImpl } = fakeFetch({ "https://token-plan-cn.xiaomimimo.com/v1/usage": { status: 200, body: { data: { balance: "42.5" }, currency: "CNY" } } });
  const payload = await readBalances({ credentials, config: {}, fetchImpl, providers: PROVIDERS });
  const entry = payload.entries.find((candidate) => candidate.id === "xiaomi-mimo");
  assert.equal(entry.kind, "ready");
  assert.deepEqual(entry.amounts, [{ currency: "CNY", text: "¥42.50" }]);
});

test("host: the credential resolver falls back to the process environment", async () => {
  const name = "DSH_ROUTE_BALANCE_TEST_KEY";
  process.env[name] = "from-process-env";
  try {
    const resolver = createCredentialResolver({ get: () => undefined });
    const hit = await resolver.resolve(name);
    assert.equal(hit.source, "process-env");
    assert.equal(hit.value, "from-process-env");

    const storeWins = createCredentialResolver({ get: () => ({ resolve: async () => ({ value: "from-store", source: "store" }) }) });
    assert.equal((await storeWins.resolve(name)).value, "from-store", "the credential store has priority");

    const throwingStore = createCredentialResolver({ get: () => ({ resolve: async () => { throw new Error("store offline"); } }) });
    await assert.rejects(() => throwingStore.resolve(name), /store offline/, "a store denial must not be bypassed through environment fallback");
  } finally {
    delete process.env[name];
  }
});

test("host: the four built-in routes are the ones the docs promise", () => {
  assert.deepEqual(PROVIDERS.map((provider) => provider.id), ["openrouter", "zhipu-glm", "deepseek-official", "xiaomi-mimo"]);
  for (const provider of PROVIDERS) {
    assert.equal(typeof provider.credential, "string");
    assert.equal(typeof provider.read, "function");
  }
});
