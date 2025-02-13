import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import { StringSession } from 'telegram/sessions';
import input from 'input';
import fs from 'fs';

/************************************************
 * 1) Tipos e função para carregar grupos (arquivo links.txt)
 ************************************************/
interface GroupEntry {
  number: string; // Ex.: "443"
  link: string;   // Ex.: "https://t.me/LinkShare_New" ou "https://t.me/username"
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
        number: matchNum[1],
        link: matchLink[1].trim()
      });
    }
  }
  return groupEntries;
}

/************************************************
 * 2) Função que tenta entrar em um grupo/canal
 ************************************************/
async function tryJoinGroup(client: TelegramClient, link: string): Promise<boolean> {
  // Remove a parte "https://t.me/"
  const base = link.replace('https://t.me/', '').trim();

  // Se for link de convite (ex.: "+abcd" ou "joinchat/XXXX")
  if (base.startsWith('+') || base.startsWith('joinchat/')) {
    const inviteHash = base.startsWith('+')
      ? base.slice(1)
      : base.replace('joinchat/', '');

    try {
      const check = await client.invoke(
        new Api.messages.CheckChatInvite({ hash: inviteHash })
      );
      if (check instanceof Api.messages.ChatInvite) {
        if (check.requestNeeded) {
          // Se requer aprovação, não é possível entrar automaticamente
          return false;
        }
      } else if (check instanceof Api.messages.ChatInviteAlready) {
        // Já está no grupo
        return true;
      }
      await client.invoke(
        new Api.messages.ImportChatInvite({ hash: inviteHash })
      );
      return true;
    } catch (error: any) {
      if (
        error.errorMessage?.includes('USER_ALREADY_PARTICIPANT') ||
        error.errorMessage?.includes('ALREADY_INVITED')
      ) {
        return true;
      }
      return false;
    }
  } else {
    // Se for um username público (ex.: "LinkShare_New")
    const username = base;
    try {
      const entity = await client.getEntity(username);
      await client.invoke(
        new Api.channels.JoinChannel({ channel: entity })
      );
      return true;
    } catch (error: any) {
      if (error.errorMessage?.includes('USER_ALREADY_PARTICIPANT')) {
        return true;
      }
      return false;
    }
  }
}

/************************************************
 * 3) Função auxiliar para aguardar (sleep)
 ************************************************/
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/************************************************
 * 4) Função PRINCIPAL de um ciclo:
 *    - Entrada (join) nos grupos (do arquivo links.txt)
 *    - Envio das mensagens (com agendamento)
 *
 * Nesta versão:
 *    - As mensagens estão fixadas (hardcoded) conforme abaixo.
 *    - Cada conta (chip) receberá uma mensagem (rotacionando o array de 5 mensagens).
 *    - Após enviar, o script tenta fixar (pin) a mensagem no grupo.
 ************************************************/
async function runCycle() {
  /************************************************
   * A) Mensagens fixadas (hardcoded)
   ************************************************/
  const fixedMessages: string[] = [
    `🔞 Proibido pra mente fraca… só clique se aguentar 😈
🔗 https://t.me/+3jtj8AjcapAxMTIx`,
    `⚠ Segredo sujo revelado… entra rápido! 😏🔥
🔗 https://t.me/+FeCu-TUPwKBkZDA5`,
    `😈 Quem entra, não volta o mesmo… coragem?
🔗 https://t.me/+G6ysVh7XADoyNjRh`,
    `👀 Tá pronto pra ver o que ninguém deveria?
🔗 https://t.me/+3PpDjsB-N_NhMjkx`,
    `🚪 A porta abriu… mas fecha em segundos. Entra!
🔗 https://t.me/+GKi-YNDWFt45YzEx`
  ];
  console.log("[CONFIG] Mensagens fixadas carregadas.");

  /************************************************
   * B) Carregar os grupos do arquivo "links.txt"
   ************************************************/
  const filePath = 'links.txt';
  const groupEntries = loadGroupEntries(filePath);
  console.log(`[OK] Carregamos ${groupEntries.length} linhas do arquivo '${filePath}'.`);

  /************************************************
   * C) Conectar até 30 contas ("chips")
   ************************************************/
  const clients: { client: TelegramClient; index: number }[] = [];
  for (let i = 1; i <= 30; i++) {
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
    return;
  }
  console.log(`[INFO] Total de contas conectadas: ${clients.length}`);

  /************************************************
   * D) Atribuir a cada conta (chip) uma mensagem:
   *     - São 5 mensagens fixadas; se houver mais contas, elas serão rotacionadas.
   ************************************************/
  const sortedClients = clients.sort((a, b) => a.index - b.index);
  const assignedMessages: Record<number, string> = {};
  sortedClients.forEach((entry, i) => {
    const messageIndex = i % fixedMessages.length;
    assignedMessages[entry.index] = fixedMessages[messageIndex];
  });

  /************************************************
   * E) Fazer cada conta entrar nos grupos/canais (do arquivo links.txt)
   *    – Em lotes de 10, com uma pausa de 2 minutos entre cada lote.
   ************************************************/
  const joinedGroups: Record<number, GroupEntry[]> = {};
  console.log('\n[INFO] Iniciando processo de entrada em grupos/canais em lotes de 10...');
  const chunkSize = 10;
  for (const { client, index } of sortedClients) {
    console.log(`\n[INFO] Conta #${index}: Processando entrada em grupos...`);
    joinedGroups[index] = [];
    for (let start = 0; start < groupEntries.length; start += chunkSize) {
      const chunk = groupEntries.slice(start, start + chunkSize);
      console.log(`[INFO] Conta #${index} - Processando grupos ${start + 1} até ${start + chunk.length}...`);
      for (const entry of chunk) {
        try {
          const joined = await tryJoinGroup(client, entry.link);
          if (joined) {
            console.log(`[OK] Conta #${index} entrou (ou já estava) no grupo #${entry.number} => ${entry.link}`);
            joinedGroups[index].push(entry);
          } else {
            console.log(`[ERRO] Conta #${index} falhou ao entrar no grupo #${entry.number} => ${entry.link}`);
          }
        } catch (err: any) {
          console.log(`[ERRO] Conta #${index} => Grupo #${entry.number} => ${err.errorMessage || err}`);
        }
      }
      console.log(`[INFO] Conta #${index} - Aguardando 2 minutos antes do próximo lote...`);
      await sleep(2 * 60 * 1000);
    }
  }
  console.log('\n[INFO] Finalizado o processo de entrada em grupos para todas as contas.');

  /************************************************
   * F) Agendamento do envio das mensagens:
   *    - Dividimos os chips em 4 slots (aproximadamente):
   *         Slot 0: 00:00 (delay 0)
   *         Slot 1: 00:02 (delay 2 min)
   *         Slot 2: 00:04 (delay 4 min)
   *         Slot 3: 00:06 (delay 6 min)
   *
   *    Para cada chip, calculamos o slot com base na sua posição
   *    na lista ordenada e agendamos o envio.
   *
   *    Após enviar a mensagem em cada grupo, o script tenta fixá-la (pin).
   ************************************************/
  console.log('\n[INFO] Agendando envios de mensagens conforme horários programados...');
  const totalClients = sortedClients.length;
  const sendPromises = sortedClients.map((entry, sortedIndex) => {
    return new Promise<void>((resolve) => {
      const slot = Math.floor(sortedIndex * 4 / totalClients); // valores de 0 a 3
      const delay = slot * 2 * 60 * 1000; // 0, 2, 4 ou 6 minutos
      setTimeout(async () => {
        const msg = assignedMessages[entry.index];
        const groupsForThisAccount = joinedGroups[entry.index] || [];
        console.log(`[SENDING] Conta #${entry.index} enviando mensagem fixa "${msg}" em ${groupsForThisAccount.length} grupo(s) (slot ${slot}, delay ${delay / 60000} min)...`);
        for (const grp of groupsForThisAccount) {
          try {
            // Envia a mensagem e obtém o objeto retornado (com o id da mensagem)
            const sentMessage = await entry.client.sendMessage(grp.link, { message: msg });
            console.log(`[OK] Conta #${entry.index}: Mensagem enviada no grupo #${grp.number}`);
            // Tenta fixar (pinar) a mensagem
            try {
              const channelEntity = await entry.client.getEntity(grp.link);
              await entry.client.invoke(new Api.channels.PinMessage({
                channel: channelEntity,
                id: sentMessage.id,
                silent: false,
              }));
              console.log(`[OK] Conta #${entry.index}: Mensagem fixada no grupo #${grp.number}`);
            } catch (pinError: any) {
              console.log(`[ERRO] Conta #${entry.index} => Grupo #${grp.number} => Falha ao fixar mensagem: ${pinError.errorMessage || pinError}`);
            }
          } catch (err: any) {
            console.log(`[ERRO] Conta #${entry.index} => Grupo #${grp.number} => Falha ao enviar: ${err.errorMessage || err}`);
          }
          // (Opcional) Pequeno delay entre envios na mesma conta:
          // await sleep(1000);
        }
        resolve();
      }, delay);
    });
  });
  await Promise.all(sendPromises);
  console.log('\n[TÉRMINO] Envio de mensagens concluído para todas as contas!');
}

/************************************************
 * 5) LOOP INFINITO: repete runCycle() a cada 1 hora
 ************************************************/
async function main() {
  while (true) {
    console.log('\n[LOOP] Iniciando novo ciclo de join + envio de mensagens...');
    await runCycle();
    console.log('\n[LOOP] Ciclo concluído. Aguardando 1 hora para reiniciar...');
    await sleep(60 * 60 * 1000); // 1 hora
  }
}

main().catch((err) => {
  console.error('[ERRO CRÍTICO]', err);
  process.exit(1);
});
