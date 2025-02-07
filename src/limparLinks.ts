import fs from 'fs';

async function main() {
  const inputFile = 'links.txt';
  const outputFile = 'links-limpo.txt';

  try {
    // Lê todo o conteúdo de links.txt
    const allLines = fs.readFileSync(inputFile, 'utf-8').split('\n');

    // Filtra apenas as linhas que NÃO contêm "> Fabricio:"
    const filteredLines = allLines.filter(
      (line) => !line.includes('> Fabricio:')
    );

    // Escreve o resultado em links-limpo.txt
    fs.writeFileSync(outputFile, filteredLines.join('\n'), 'utf-8');

    console.log(`Arquivo "${outputFile}" gerado sem as linhas "> Fabricio:".`);
  } catch (err) {
    console.error('Ocorreu um erro ao processar o arquivo:', err);
  }
}

main();
