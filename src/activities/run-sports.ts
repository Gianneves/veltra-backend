/**
 * Esportes do Strava tratados como corrida pela ingestão.
 *
 * Fonte única usada pelo webhook, pelo backfill da geração de plano e pela
 * análise semanal, para que todos os caminhos considerem o mesmo conjunto.
 */
export const RUN_SPORTS: string[] = ['Run', 'TrailRun', 'VirtualRun'];
