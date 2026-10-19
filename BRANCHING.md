# Branch & release policy

One long-lived branch: **`main`**. (Until 2026-10-19 we used `dev` → `stage` → `main`
because DigitalOcean deployed by branch; that is retired. `dev` and `stage` are kept
read-only for a few weeks for reference, then deleted.)

| Step | What happens |
|------|--------------|
| Work | Short-lived feature branch off `main`, merged back by pull request (or a direct push for small fixes) |
| Dev | Every push to `main` builds and deploys to **dev** automatically (Oracle server, `.github/workflows/deploy-oci.yml`) |
| Stage | Promote a build that already passed on dev — the same commit, no merge |
| Prod | Promote the same commit again, with a version tag and the owner's approval |

## Rules

1. Pull `main` before you change anything; keep feature branches short.
2. Unfinished features ship hidden behind a switch (like the OPD dark build), never on a long-lived branch.
3. Environment settings (database, keys, storage) come from each server's settings file, never from code.
4. Nothing goes to stage or prod without the owner's go-ahead.
