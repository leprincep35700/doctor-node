# CLAUDE.md

## Webhooks (FACTUEL)
- Les webhooks ne livrent QUE les échecs, jamais les succès.
- Ne JAMAIS attendre un webhook de succès, il n'arrivera pas.
- Pour confirmer qu'un job a réussi : interroger directement
  [ton endpoint/commande de statut] et vérifier le statut réel.
01895e8 (docs: add GitHub CI polling guidance)

## Pitfall — Attendre une CI GitHub verte (polling)

**Contexte** : CI **GitHub Actions** de ce repo — deux checks par PR : `ci`
(lint/typecheck/unit) et `docker-build` (image + smoke). GitHub uniquement
via l'outil MCP (`mcp__github__*`), pas de `gh` CLI ni de token en bash.

**Symptôme** : on « attend que la CI passe au vert » mais on tombe toujours
juste avant la fin (« `ci` vert, `docker-build` en cours… ») et on re-programme
un réveil long → impression d'attente sans fin, et la session dort pour rien.

**Cause** : les webhooks GitHub ne notifient QUE les échecs CI et les reviews —
**jamais un succès**. Entre deux tours la session est dormante : le seul moyen
de constater un « vert » est un réveil qu'on a soi-même armé. Un intervalle fixe
long (≥ 5 min) ne se cale jamais sur une durée de build variable. On ne peut pas
faire `while !vert: sleep` (sleep avant-plan bloqué + GitHub inaccessible depuis
bash → uniquement via MCP).

**Règle** :
- Ne jamais merger sur un check partiel : attendre que **TOUS** les checks
  GitHub (`ci` **et** `docker-build`) soient `completed/success`.
- Pour attendre un vert : **réveils courts (~45–60 s) répétés jusqu'au vert**,
  pas un gros intervalle fixe ; resserrer près de la fin estimée du build.
- `docker-build` ≈ 2–3 min après `ci` : attendre cette durée **puis** sonder
  court — ne pas sonder pile à la durée estimée.
- Annoncer « la CI GitHub tourne ~N min, je reviens quand c'est vert » plutôt
  que d'égrener des « toujours en cours ».

**Vérification** : un seul appel `mcp__github__pull_request_read`
(`get_check_runs`) montre les deux checks en `completed/success` avant merge ;
peu de cycles d'attente (pas 4+ réveils qui ratent la fin de peu).


## Règle — Surveillance CI GitHub jusqu'au vert

Quand on attend une CI GitHub verte, ne pas supposer qu'un webhook ou Claude préviendra au succès. Les notifications fiables couvrent surtout les échecs/reviews ; un succès doit être constaté par polling.

Cadence par défaut :
- Vérifier d'abord les checks/jobs réels et le SHA concerné.
- Si les jobs sont `pending`/`queued`, re-sonder toutes les 2–3 minutes.
- Dès que les jobs sont `in_progress` ou proches de leur durée habituelle, resserrer à 45–60 secondes jusqu'au vert.
- Ne jamais annoncer « vert », « ready » ou merger sur un statut partiel/stale : tous les required checks du dernier SHA doivent être `completed/success`.
- Si la file runner est saturée, dire explicitement qu'on surveille à cadence courte au lieu de laisser dormir la session.
