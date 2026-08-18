import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const ACCOUNT_ID = "c03bc95dc19a0f1c0f22e95562a275db";
const BUCKET = "alcohol-log-images";
const TEMP_DIR = "./temp_thumbs";

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function main() {
  console.log("1. Fetching image list from D1...");
  const d1Output = execSync(
    `npx wrangler d1 execute alcohol-log --remote --command="SELECT id, image_key, thumbnail_key FROM sake_images WHERE image_key IS NOT NULL AND thumbnail_key IS NOT NULL;" --json`,
    {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
      encoding: "utf-8",
    }
  );

  const parsed = JSON.parse(d1Output);
  const rows = parsed[0]?.results || [];
  console.log(`Found ${rows.length} images to process.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { id, image_key, thumbnail_key } = row;
    console.log(`\n[${i + 1}/${rows.length}] Processing Image #${id}...`);
    console.log(`  Source: ${image_key}`);
    console.log(`  Target: ${thumbnail_key}`);

    const origTemp = path.join(TEMP_DIR, `orig_${id}_${Date.now()}`);
    const thumbTemp = path.join(TEMP_DIR, `thumb_${id}_${Date.now()}.webp`);

    try {
      // 1. Download original from R2
      execSync(
        `npx wrangler r2 object get "${BUCKET}/${image_key}" --file="${origTemp}" --remote`,
        {
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
          stdio: "pipe",
        }
      );

      // 2. Resize with Sharp to 720px crisp WebP
      await sharp(origTemp)
        .rotate() // Auto-orient based on EXIF
        .resize(720, 720, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82, effort: 4 })
        .toFile(thumbTemp);

      const thumbStat = fs.statSync(thumbTemp);
      console.log(`  Resized to WebP: ${(thumbStat.size / 1024).toFixed(1)} KB`);

      // 3. Upload thumbnail to R2
      execSync(
        `npx wrangler r2 object put "${BUCKET}/${thumbnail_key}" --file="${thumbTemp}" --content-type="image/webp" --remote`,
        {
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
          stdio: "pipe",
        }
      );

      console.log(`  ✅ Successfully updated thumbnail in R2!`);
      successCount++;
    } catch (err) {
      console.error(`  ❌ Failed to process #${id}:`, err.message);
      failCount++;
    } finally {
      if (fs.existsSync(origTemp)) fs.unlinkSync(origTemp);
      if (fs.existsSync(thumbTemp)) fs.unlinkSync(thumbTemp);
    }
  }

  // Cleanup temp dir
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmdirSync(TEMP_DIR, { recursive: true });
  }

  console.log(`\n========================================`);
  console.log(`🎉 Finished thumbnail regeneration!`);
  console.log(`Total: ${rows.length}, Success: ${successCount}, Failed: ${failCount}`);
  console.log(`========================================`);
}

main().catch(console.error);
