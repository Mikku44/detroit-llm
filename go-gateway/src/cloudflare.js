import { Container, getContainer } from "@cloudflare/containers";
import { env as workerEnv } from "cloudflare:workers";

const PASSTHROUGH_ENV = [
  "GO_GATEWAY_PORT",
  "BACKEND_URL",
  "SGLANG_URL",
  "DASHBOARD_URL",
  "RATE_LIMIT_PER_MINUTE",
  "DATABASE_URL",
  "CONVERSATIONS_DB_URL",
  "JWT_SECRET",
  "DEEPSEEK_URL",
  "DEEPSEEK_API_KEY",
  "Z_AI_URL",
  "Z_API_KEY",
  "DASHSCOPE_URL",
  "DASHSCOPE_API_KEY",
  "GROK_API_URL",
  "GROK_API_KEY",
  "XAI_API_KEY",
  "GROK_IMAGE_MODEL",
  "MUSE_SPARK_URL",
  "MUSE_SPARK_API_KEY",
  "MODEL_API_KEY",
  "IMAGE_PROVIDER"
];

function containerEnvironment() {
  return Object.fromEntries(
    PASSTHROUGH_ENV.flatMap((name) => {
      const value = workerEnv[name];
      return typeof value === "string" && value.length > 0 ? [[name, value]] : [];
    })
  );
}

export class GoGatewayContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2h";
  enableInternet = true;
  envVars = containerEnvironment();
}

export default {
  fetch(request, env) {
    const gateway = getContainer(env.GO_GATEWAY_CONTAINER, "singleton");
    return gateway.fetch(request);
  }
};
