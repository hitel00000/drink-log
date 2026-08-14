import { fetchSingleSakeRecordEntry, updateSakeRecordEntry, deleteSakeRecordEntry } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  fetchSingleSakeRecordEntry(request, env, String(params.id), executionCtx);

export const onRequestPut: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  updateSakeRecordEntry(request, env, String(params.id), executionCtx);

export const onRequestDelete: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  deleteSakeRecordEntry(request, env, String(params.id), executionCtx);
