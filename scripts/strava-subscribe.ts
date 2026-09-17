import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const STRAVA_API = 'https://www.strava.com/api/v3';

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    list: argv.includes('--list'),
    deleteId: get('--delete'),
    callbackUrl:
      get('--callback-url') ?? process.env.STRAVA_WEBHOOK_CALLBACK_URL,
  };
}

async function main() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  const options = parseArgs();

  if (!clientId || !clientSecret) {
    throw new Error(
      'STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET precisam estar no .env',
    );
  }

  const authParams = {
    client_id: clientId,
    client_secret: clientSecret,
  };

  if (options.list) {
    const { data } = await axios.get(`${STRAVA_API}/push_subscriptions`, {
      params: authParams,
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (options.deleteId) {
    await axios.delete(
      `${STRAVA_API}/push_subscriptions/${options.deleteId}`,
      { params: authParams },
    );
    console.log(`Subscription ${options.deleteId} removida.`);
    return;
  }

  if (!options.callbackUrl) {
    throw new Error(
      'Informe --callback-url https://<host>/api/v1/strava/webhook (ou STRAVA_WEBHOOK_CALLBACK_URL)',
    );
  }

  if (!verifyToken) {
    throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN ausente no .env');
  }

  const { data } = await axios.post(`${STRAVA_API}/push_subscriptions`, {
    ...authParams,
    callback_url: options.callbackUrl,
    verify_token: verifyToken,
  });

  console.log('Subscription criada:', JSON.stringify(data, null, 2));
}

main().catch((error: unknown) => {
  const axiosError = axios.isAxiosError(error) ? error.response?.data : null;
  console.error('Falha:', axiosError ?? (error as Error).message);
  process.exit(1);
});
