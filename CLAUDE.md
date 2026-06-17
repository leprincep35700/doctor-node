# CLAUDE.md

## Webhooks (FACTUEL)
- Les webhooks ne livrent QUE les échecs, jamais les succès.
- Ne JAMAIS attendre un webhook de succès, il n'arrivera pas.
- Pour confirmer qu'un job a réussi : interroger directement
  [ton endpoint/commande de statut] et vérifier le statut réel.
