// How soon the script is there: from its run to its buttons in the page, and from the press of the switch to the
// video's opening (POST /v1/videos). Printed (the medians of five runs); the bounds only catch a script gone slow.
import { expect, test } from './harness';

test('startup: buttons and the first POST', async ({ open }) => {
  const runs: { mounted: number; post: number; total: number }[] = [];
  for (let n = 0; n < 5; n++) {
    const o = await open('manual');
    await o.main();
    await expect.poll(async () => (await o.marks()).post, { timeout: 10_000 }).toBeGreaterThan(0);
    const m = await o.marks();
    runs.push({ mounted: m.mounted! - m.init!, post: m.post! - m.click!, total: m.post! - m.init! });
    await o.page.close();
  }
  const median = (k: keyof (typeof runs)[number]) => runs.map((r) => r[k]).sort((a, b) => a - b)[2]!;
  const line = `startup ${test.info().project.name}: buttons ${median('mounted').toFixed(1)} ms after the run, ` +
    `POST ${median('post').toFixed(1)} ms after the press (run to POST, the press at once: ${median('total').toFixed(1)} ms)`;
  console.log(line);
  test.info().annotations.push({ type: 'startup', description: line });
  expect(median('mounted')).toBeLessThan(1000);
  expect(median('post')).toBeLessThan(1000);
});
