/**
 * IOServices - Singleton registry for Input/Output services.
 *
 * Provides environment-agnostic I/O access across the agent framework.
 * Components like ConversationalTskillController can access I/O without explicit wiring.
 *
 * Usage:
 *   // At bootstrap (e.g., cli-loop.mjs):
 *   import { IOServices } from 'achillesAgentLib/services/IOServices.mjs';
 *   import { CLIInputReader } from 'achillesAgentLib/services/InputReader.mjs';
 *   import { CLIOutputWriter } from 'achillesAgentLib/services/OutputWriter.mjs';
 *
 *   IOServices.setInputReader(new CLIInputReader(readlineInterface));
 *   IOServices.setOutputWriter(new CLIOutputWriter());
 *
 *   // Anywhere in the codebase:
 *   import { IOServices } from 'achillesAgentLib/services/IOServices.mjs';
 *
 *   const writer = IOServices.getOutputWriter();
 *   if (writer) {
 *       await writer.write('Processing...');
 *   }
 */

let inputReader = null;
let outputWriter = null;

export const IOServices = {
    /**
     * Set the input reader instance.
     * @param {InputReader} reader - The input reader to use.
     */
    setInputReader(reader) {
        inputReader = reader;
    },

    /**
     * Get the current input reader instance.
     * @returns {InputReader|null} The input reader or null if not set.
     */
    getInputReader() {
        return inputReader;
    },

    /**
     * Set the output writer instance.
     * @param {OutputWriter} writer - The output writer to use.
     */
    setOutputWriter(writer) {
        outputWriter = writer;
    },

    /**
     * Get the current output writer instance.
     * @returns {OutputWriter|null} The output writer or null if not set.
     */
    getOutputWriter() {
        return outputWriter;
    },

    /**
     * Check if I/O services are available.
     * @returns {boolean} True if both reader and writer are set.
     */
    isAvailable() {
        return inputReader !== null && outputWriter !== null;
    },

    /**
     * Clear all I/O services. Useful for testing or cleanup.
     */
    clear() {
        inputReader = null;
        outputWriter = null;
    },
};

export default IOServices;
