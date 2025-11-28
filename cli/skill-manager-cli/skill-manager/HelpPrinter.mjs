/**
 * HelpPrinter - Stateless utility functions for displaying help and history.
 *
 * Extracted from SkillManagerCli to reduce file size and improve modularity.
 */

/**
 * Print the quick reference help screen.
 */
export function printHelp() {
    console.log(`
+----------------------------------------------------------+
|                     Quick Reference                       |
+----------------------------------------------------------+

Quick Commands (no LLM):
  list, ls          List user skills
  list all, ls -a   List all skills (including built-in)
  reload            Refresh skills from disk
  history, hist     Show recent command history
  help              Show this help
  exit, quit, q     Exit the CLI
  Esc               Cancel running operation

Slash Commands (direct skill execution):
  /help             Show all slash commands
  /ls               List skills
  /read <skill>     Read skill definition
  /write <skill>    Create/update skill
  /validate <skill> Validate against schema
  /generate <skill> Generate code from tskill
  /test <skill>     Test generated code
  /refine <skill>   Iteratively improve skill
  /exec <skill>     Execute any skill directly

Natural Language Examples:
  "list all skills"
  "read the equipment skill"
  "create a new tskill called inventory"
  "validate the area skill"
  "generate code for equipment"

Skill Types:
  tskill - Database table (fields, validators, etc.)
  cskill - Code skill (LLM generates code)
  iskill - Interactive (commands, user input)
  oskill - Orchestrator (routes to other skills)
  mskill - MCP tool integration
`);
}

/**
 * Show recent command history.
 *
 * @param {HistoryManager} historyManager - The history manager instance
 * @param {number} count - Number of recent commands to show (default: 20)
 */
export function showHistory(historyManager, count = 20) {
    const recent = historyManager.getRecent(count);
    if (recent.length === 0) {
        console.log('\nNo command history yet.\n');
        return;
    }

    console.log(`\nCommand history (last ${recent.length} of ${historyManager.length}):`);
    recent.forEach(({ index, command }) => {
        console.log(`  ${index.toString().padStart(4)}  ${command}`);
    });
    console.log(`\nHistory stored at: ${historyManager.getHistoryPath()}\n`);
}

/**
 * Search command history for matching entries.
 *
 * @param {HistoryManager} historyManager - The history manager instance
 * @param {string} query - Search query
 * @param {number} limit - Maximum results to show (default: 20)
 */
export function searchHistory(historyManager, query, limit = 20) {
    const results = historyManager.search(query, limit);
    if (results.length === 0) {
        console.log(`\nNo history entries matching "${query}".\n`);
        return;
    }

    console.log(`\nHistory entries matching "${query}":`);
    results.forEach(({ index, command }) => {
        console.log(`  ${index.toString().padStart(4)}  ${command}`);
    });
    console.log('');
}

export default {
    printHelp,
    showHistory,
    searchHistory,
};
