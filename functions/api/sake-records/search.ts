import { searchSakeRecordsEntry } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request, executionCtx }) =>
  searchSakeRecordsEntry(request, env, executionCtx);
