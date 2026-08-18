import { moldApp } from "../_shared/generated/mold_app";
import { getDatabase, getImagesBucket, type AppEnv } from "../_shared/auth";

export const onRequest: PagesFunction<AppEnv> = async (context) => {
  const { request, env, executionCtx } = context;
  const db = getDatabase(env);
  let bucket: R2Bucket | undefined;
  try {
    bucket = getImagesBucket(env);
  } catch (e) {}

  const mappedEnv = {
    ...env,
    DB: db,
    BUCKET: bucket,
  };

  return moldApp.fetch(request, mappedEnv, executionCtx);
};
