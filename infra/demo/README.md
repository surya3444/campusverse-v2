# Demo environment: demo-v2.campusverse.app

A public demo with synthetic data. The web app runs on Vercel (Mumbai functions); the API, worker,
Postgres, Valkey and Caddy (HTTPS) run in Docker on one EC2 server in Mumbai. `APP_ENV=test`:
the top bar says Test, and sign-in codes and messages show on screen instead of being sent.
Anyone can sign up and sign in with any number, so **never put real student data here**. The
proper live environment is `infra/envs/live` (Terraform, ECS, RDS), not this.

| Piece     | Where                                                               |
| --------- | ------------------------------------------------------------------- |
| Web       | `https://demo-v2.campusverse.app` (Vercel project, root `apps/web`) |
| API       | `https://api.demo-v2.campusverse.app` (EC2, Caddy → api:4000)       |
| Documents | S3 bucket in ap-south-1 (private)                                   |

## One-time setup (owner)

1. **Server.** EC2 in ap-south-1: Ubuntu 24.04, x86 (64-bit), a **Free tier eligible** type:
   the largest one offered (`m7i-flex.large` or `c7i-flex.large` if listed, else `t3.small`, else
   `t3.micro`); 30 GB gp3. Security group: 22 from your IP only; 80 and 443 from anywhere. Allocate an
   Elastic IP and attach it. Images are built on your machine and shipped (`deploy.sh`), and the server
   gets 2 GB of swap, so 1 GB of memory is enough (idle use is about 450 MB).
2. **Bucket.** S3 bucket in ap-south-1 (Block all public access on), for example
   `campusverse-v2-demo-docs`. The server reaches it through an IAM role (no access keys): role
   `campusverse-v2-demo-server` (trusted by EC2) with `s3:ListBucket` on the bucket and
   `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on its objects, attached to the instance; the
   instance's metadata hop limit set to 2 (the app runs in Docker). CORS (Permissions → CORS):
   `[{"AllowedOrigins":["https://demo-v2.campusverse.app"],"AllowedMethods":["GET","PUT"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]`
3. **DNS at GoDaddy** (campusverse.app → DNS):
   - `A` record, name `api.demo-v2`, value = the Elastic IP.
   - `CNAME` record, name `demo-v2`, value = what Vercel shows after step 5 (usually `cname.vercel-dns.com`).
4. **Server deploy** (from the repo root on your machine):
   `bash infra/demo/deploy.sh <elastic-ip> <key.pem> <bucket>`
   It builds the images here (x86), copies the code, prepares the server (Docker, swap), ships the
   images, carries the hub's OpenAI key over, writes fresh secrets on the
   server (`infra/demo/.env`), creates the database logins, migrates and starts. **Back up that
   `.env`**: `FIELD_KEYS` opens sealed Aadhaar and bank details.
5. **Vercel** (from `apps/web`, logged in to the right account):
   ```sh
   vercel link --yes --project campusverse-v2-demo
   # Project → Settings → General: Root Directory = apps/web (keep "include files outside").
   printf 'test' | vercel env add APP_ENV production
   printf 'https://api.demo-v2.campusverse.app' | vercel env add API_URL production
   printf '1' | vercel env add ENABLE_EXPERIMENTAL_COREPACK production
   vercel deploy --prod
   vercel domains add demo-v2.campusverse.app
   ```

## Updating

- API and worker: `bash infra/demo/deploy.sh <elastic-ip> <key.pem>` (migrations run each time).
- Web: `vercel deploy --prod` from `apps/web`.

## Checks

- `curl https://api.demo-v2.campusverse.app/api/v1/health/ready` → `{"ok":true}`
- Open `https://demo-v2.campusverse.app/signup`, sign up a synthetic school; the code shows on screen.
- On the server: `cd ~/campusverse-v2/infra/demo && docker compose ps`, `docker compose logs -f api`.

## Known limits of the demo

- One server, no replicas; a reboot restarts everything (`restart: unless-stopped`).
- Database backups: none automatic. `docker compose exec postgres pg_dump -U campusverse campusverse > backup.sql` before risky changes.
- Requests reach the API from Vercel's servers, so sign-in rate limits count per Vercel address,
  not per visitor.
