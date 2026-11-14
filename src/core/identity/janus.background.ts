// Work a request starts and does not wait for: a mail whose sending must not
// show in the response's time, which would tell whether the account exists.
// A failure is logged (its name and message), never thrown at anyone.
// `settled()` waits until none runs: a spec reads the outbox after it.
export function background(log: (line: string) => void = console.error) {
  const running = new Set<Promise<void>>();
  return {
    run(name: string, task: () => Promise<unknown>) {
      const done: Promise<void> = Promise.resolve()
        .then(task)
        .then(
          () => undefined,
          (error: unknown) => {
            const reason =
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);
            log(`storix-api: ${name} failed in the background: ${reason}`);
          },
        )
        .finally(() => running.delete(done));
      running.add(done);
    },
    async settled() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export type Background = ReturnType<typeof background>;
