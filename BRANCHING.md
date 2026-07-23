# Branch & promotion policy

Three **permanent** environment branches — none may ever be deleted:

| Branch  | Environment | Deploys via |
|---------|-------------|-------------|
| `dev`   | Development | DigitalOcean rebuilds the dev app on push |
| `stage` | Staging     | DigitalOcean rebuilds the stage app on push |
| `main`  | Production  | DigitalOcean rebuilds the prod app on push |

DigitalOcean has no separate release step — a push to an environment branch
**is** that environment's release. "Promote" therefore means *carry the code
forward onto the next branch* so DO rebuilds it.

## Rules

1. **Feature/sub-branches** branch off `dev` and merge back into `dev`. You may
   push to `dev` directly. Feature branches can be deleted after merge.
2. **Promotion is linear and adjacent-only:** `dev → stage → main`.
   - `stage` accepts merges **only from `dev`**.
   - `main` accepts merges **only from `stage`**.
   - `dev → main` directly is **prohibited**. No cross-merges. No back-merges
     into `dev` (nothing merges *into* `dev` except feature branches).
3. **Promotion never deletes the source.** `dev` and `stage` stay put and keep
   accumulating; a promotion is a forward merge, not a move.
4. `dev`, `stage`, `main` **cannot be deleted** (enforced by branch protection).

## How to promote

Open a pull request from the source to the target environment branch:

- **Promote to staging:** PR `dev` → `stage`
- **Promote to production:** PR `stage` → `main`

The **`promotion-gate`** CI check (`.github/workflows/promotion-gate.yml`) fails
any PR to `stage` not from `dev`, or to `main` not from `stage`. It is a required
status check on both branches, so a wrong-direction PR cannot be merged.
