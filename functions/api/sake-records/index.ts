import { fetchSakeRecordsEntry, moldApp, getMappedEnv } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) =>
  fetchSakeRecordsEntry(request, env, executionCtx);

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) => {
  const mappedEnv = getMappedEnv(env);
  const targetReq = new Request("http://localhost/api/sake_records", request);
  return moldApp.fetch(targetReq, mappedEnv, executionCtx);
};
