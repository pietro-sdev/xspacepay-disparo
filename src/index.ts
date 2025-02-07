import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import { StringSession } from 'telegram/sessions';
import input from 'input';
import fs from 'fs';

/************************************************
 * 1) Tipos e Funções para Carregar links.txt
 ************************************************/
interface GroupEntry {
  number: string; // ex: "443"
  link: string;   // ex: "https://t.me/+abcd123" ou "https://t.me/username"
}

function loadGroupEntries(filePath: string): GroupEntry[] {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const groupEntries: GroupEntry[] = [];

  for (const line of lines) {
    // Exemplo de linha: "N°443 https://t.me/LinkShare_New #7k 📎"
    const matchNum = line.match(/N°(\d+)/i);
    const matchLink = line.match(/(https:\/\/t\.me\/\S+)/i);

    if (matchNum && matchLink) {
      groupEntries.push({
        number: matchNum[1],      // "443"
        link: matchLink[1].trim() // "https://t.me/LinkShare_New"
      });
    }
  }
  return groupEntries;
}

/************************************************
 * 2) Função que tenta entrar em um grupo/canal
 ************************************************/
async function tryJoinGroup(client: TelegramClient, link: string): Promise<boolean> {
  // Remove 'https://t.me/'
  const base = link.replace('https://t.me/', '').trim();

  // Se for invite link (ex: +abcd ou joinchat/XXXX)
  if (base.startsWith('+') || base.startsWith('joinchat/')) {
    const inviteHash = base.startsWith('+')
      ? base.slice(1) // remove '+'
      : base.replace('joinchat/', '');

    try {
      // Verifica se o link ainda é válido (pode exigir aprovação ou estar expirado)
      const check = await client.invoke(
        new Api.messages.CheckChatInvite({ hash: inviteHash })
      );
      // Se for ChatInviteAlready => já estamos no grupo
      // Se for ChatInvite com requestNeeded => requer aprovação do admin

      if (check instanceof Api.messages.ChatInvite) {
        if (check.requestNeeded) {
          // Se requer aprovação do admin, não dá pra entrar automaticamente
          return false;
        }
      } else if (check instanceof Api.messages.ChatInviteAlready) {
        // Já dentro do grupo
        return true;
      }

      // Tenta entrar de fato
      await client.invoke(
        new Api.messages.ImportChatInvite({ hash: inviteHash })
      );

      return true;
    } catch (error: any) {
      // Erros: INVITE_HASH_EXPIRED, USER_BANNED_IN_CHANNEL, etc.
      if (
        error.errorMessage?.includes('USER_ALREADY_PARTICIPANT') ||
        error.errorMessage?.includes('ALREADY_INVITED')
      ) {
        return true;
      }
      return false;
    }

  } else {
    // Caso seja um username público (ex: "LinkShare_New")
    const username = base;
    try {
      const entity = await client.getEntity(username);
      // Tenta entrar usando JoinChannel
      await client.invoke(
        new Api.channels.JoinChannel({ channel: entity })
      );
      return true;
    } catch (error: any) {
      // Erros: USER_ALREADY_PARTICIPANT, CHANNEL_PRIVATE, JOIN_AS_REQUEST, etc.
      if (error.errorMessage?.includes('USER_ALREADY_PARTICIPANT')) {
        return true;
      }
      return false;
    }
  }
}

/************************************************
 * 3) Função Auxiliar de "sleep"
 ************************************************/
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/************************************************
 * 4) Função PRINCIPAL de um ciclo (entrar + enviar)
 ************************************************/
async function runCycle() {
  // A) Carregar links do arquivo
  const filePath = 'links.txt';
  const groupEntries = loadGroupEntries(filePath);
  console.log(`\n[OK] Carregamos ${groupEntries.length} linhas do arquivo '${filePath}'.`);

  // B) Conectar até 20 contas
  const clients: { client: TelegramClient; index: number }[] = [];

  for (let i = 1; i <= 20; i++) {
    const apiIdStr = process.env[`TELEGRAM_API_ID${i}`];
    const apiHash = process.env[`TELEGRAM_API_HASH${i}`];
    const sessionStr = process.env[`TELEGRAM_SESSION${i}`];

    if (!apiIdStr || !apiHash || !sessionStr) {
      console.log(`[WARN] Variáveis de ambiente ausentes para a conta #${i}. Pulando...`);
      continue;
    }

    const apiId = parseInt(apiIdStr, 10);
    if (!apiId) {
      console.log(`[WARN] apiId inválido para a conta #${i}. Pulando...`);
      continue;
    }

    console.log(`\n[INFO] Iniciando conexão da Conta #${i}...`);
    const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 5
    });

    // Start (login). Se a sessão estiver válida, não pedirá phone/code
    await client.start({
      phoneNumber: async () => await input.text(`Conta #${i} - Telefone (+55...): `),
      password: async () => await input.text(`Conta #${i} - Senha 2FA (se houver): `),
      phoneCode: async () => await input.text(`Conta #${i} - Código via SMS/Telegram: `),
      onError: (err) => console.log(`[Conta #${i}] Erro de login:`, err),
    });

    console.log(`[OK] Conta #${i} conectada!`);
    clients.push({ client, index: i });
  }

  if (clients.length === 0) {
    console.error('[ERRO] Nenhuma conta conectada. Verifique seu .env.');
    return; // ou process.exit(1)
  }

  console.log(`\n[INFO] Total de contas conectadas: ${clients.length}`);

  // C) Preparar estrutura para armazenar grupos que cada conta entrou
  const joinedGroups: Record<number, GroupEntry[]> = {};

  // D) Tentar entrar nos grupos em LOTES de 10
  console.log('\n[INFO] Iniciando processo de entrar nos grupos/canais em lotes de 10...');
  const chunkSize = 10;

  for (const { client, index } of clients) {
    console.log(`\n[INFO] Conta #${index}: Entrando em grupos em lotes...`);
    joinedGroups[index] = [];

    for (let start = 0; start < groupEntries.length; start += chunkSize) {
      const chunk = groupEntries.slice(start, start + chunkSize);
      console.log(`[INFO] Conta #${index} - Processando grupos de ${start+1} até ${start+chunk.length}...`);

      for (const entry of chunk) {
        const { number, link } = entry;
        try {
          const joined = await tryJoinGroup(client, link);
          if (joined) {
            console.log(`[OK] Conta #${index} entrou (ou já estava) no grupo #${number} => ${link}`);
            joinedGroups[index].push(entry);
          } else {
            console.log(`[ERRO] Conta #${index} FALHA ao entrar no grupo #${number} => ${link}`);
          }
        } catch (err: any) {
          console.log(`[ERRO] Conta #${index} => Grupo #${number} => ${err.errorMessage || err}`);
        }
      }

      // Pausa de 2 min entre cada lote de 10
      console.log(`[INFO] Conta #${index} - Aguardando 2 minutos antes do próximo lote...`);
      await sleep(2 * 60 * 1000);
    }
  }

  console.log('\n[INFO] Finalizado o processo de entrar em todos os grupos para todas as contas.');

  // E) Perguntar qual mensagem o usuário deseja enviar
  const mensagem = await input.text('Digite a mensagem que deseja enviar em cada grupo: ');
  console.log(`\n[INFO] Mensagem definida: "${mensagem}"`);

  // F) Enviar mensagens: 10 minutos de pausa entre cada conta
  for (let i = 0; i < clients.length; i++) {
    const { client, index } = clients[i];
    const groupsForThisAccount = joinedGroups[index];
    console.log(`\n[INFO] Conta #${index} enviando mensagens em ${groupsForThisAccount.length} grupos...`);

    for (const grp of groupsForThisAccount) {
      try {
        await client.sendMessage(grp.link, { message: mensagem });
        console.log(`[OK] Conta #${index}: Mensagem enviada no grupo #${grp.number}`);
        // Se quiser um delay pequeno aqui, descomente:
        // await sleep(1000);
      } catch (err: any) {
        console.log(`[ERRO] Conta #${index} => Grupo #${grp.number} => Falha ao enviar: ${err.errorMessage || err}`);
      }
    }

    // Se ainda tiver próxima conta, esperar 10 minutos
    if (i < clients.length - 1) {
      console.log(`[INFO] Aguardando 10 minutos antes de enviar com a próxima conta...`);
      await sleep(10 * 60 * 1000);
    }
  }

  console.log('\n[TÉRMINO] Finalizado o envio de mensagens para todas as contas!');
}

/************************************************
 * 5) LOOP INFINITO: repete runCycle() de 1 em 1 hora
 ************************************************/
async function main() {
  while (true) {
    console.log('\n[LOOP] Iniciando novo ciclo de entrar+enviar mensagens...');
    await runCycle();

    console.log('\n[LOOP] Ciclo finalizado. Aguardando 1 hora para repetir...');
    await sleep(60 * 60 * 1000); // 1 hora (em ms)
  }
}

main().catch((err) => {
  console.error('[ERRO CRÍTICO]', err);
  process.exit(1);
});
