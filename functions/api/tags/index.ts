import { moldApp, getMappedEnv } from "../../_shared/glue";
import { readSession, type AppEnv } from "../../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) => {
  const mappedEnv = getMappedEnv(env);
  const session = await readSession(request, mappedEnv);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const targetReq = new Request("http://localhost/api/tags", request);
  return moldApp.fetch(targetReq, mappedEnv, executionCtx);
};

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) => {
  const mappedEnv = getMappedEnv(env);
  const session = await readSession(request, mappedEnv);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const targetReq = new Request("http://localhost/api/tags", request);
  return moldApp.fetch(targetReq, mappedEnv, executionCtx);
};
