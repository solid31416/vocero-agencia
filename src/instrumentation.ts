/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      checkMediaDir,
      cleanupOrphanRuns,
      encryptLegacySecrets,
      resumeDispatch,
      resumeWebhooks,
    } = await import("./instrumentation-node");
    await checkMediaDir();
    await cleanupOrphanRuns();
    await encryptLegacySecrets();
    resumeDispatch();
    resumeWebhooks();
    // Módulo de la agencia: recordatorios de cita (RECORDATORIOS_CITAS).
    const { iniciarRecordatorios } = await import("./server/recordatorios/worker");
    iniciarRecordatorios();
    // Módulo de la agencia: contador de mensajes y costo de Meta (CONTADOR_MENSAJES).
    const { iniciarContador } = await import("./server/contador-mensajes/worker");
    iniciarContador();
    // Módulo de la agencia: el agente aprende de sus traspasos (APRENDE_DE_TRASPASOS).
    const { iniciarAprende } = await import("./server/aprende-traspasos/analizar");
    iniciarAprende();
    // Módulo de la agencia: termómetro del cliente (TERMOMETRO_CLIENTE).
    const { iniciarTermometro } = await import("./server/termometro/clasificar");
    iniciarTermometro();
    // Módulo de la agencia: «Nadie ha contestado» (ESPERA_HUMANO).
    const { iniciarEsperaHumano } = await import("./server/espera-humano/revisar");
    iniciarEsperaHumano();
    // Módulo de la agencia: seguimiento automático 3/7/30 días (SEGUIMIENTO_AUTOMATICO).
    const { iniciarSeguimiento } = await import("./server/seguimiento/worker");
    iniciarSeguimiento();
    // Módulo de la agencia: cotizaciones — el «sí» del cliente y el seguimiento sin respuesta (COTIZACIONES).
    const { iniciarRevisorCotizaciones } = await import("./server/cotizaciones/revisor");
    iniciarRevisorCotizaciones();
    // Módulo de la agencia: recordarle el saldo al cliente el día de cobro (PEDIDOS).
    const { iniciarRecordarSaldo } = await import("./server/pedidos/recordar-saldo");
    iniciarRecordarSaldo();
  }
}
