import { fetchSakeRecordsEntry, createSakeRecordEntry } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) =>
  fetchSakeRecordsEntry(request, env, executionCtx);

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) =>
  createSakeRecordEntry(request, env, executionCtx);
