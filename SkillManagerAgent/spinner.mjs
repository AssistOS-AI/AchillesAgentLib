/**
 * CLI Spinner - Animated loading indicator for long-running operations
 */

const SPINNER_FRAMES = {
    dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    line: ['|', '/', '-', '\\'],
    arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
    circle: ['◐', '◓', '◑', '◒'],
    square: ['◰', '◳', '◲', '◱'],
    bounce: ['⠁', '⠂', '⠄', '⠂'],
    pulse: ['█', '▓', '▒', '░', '▒', '▓'],
    arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
    clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
};

const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
};

export class Spinner {
    constructor(options = {}) {
        this.frames = SPINNER_FRAMES[options.style] || SPINNER_FRAMES.dots;
        this.interval = options.interval || 80;
        this.color = COLORS[options.color] || COLORS.cyan;
        this.stream = options.stream || process.stderr;

        this.frameIndex = 0;
        this.timer = null;
        this.message = '';
        this.startTime = null;
        this.isSpinning = false;
    }

    start(message = 'Processing') {
        if (this.isSpinning) return this;

        this.isSpinning = true;
        this.message = message;
        this.startTime = Date.now();
        this.frameIndex = 0;

        // Hide cursor
        this.stream.write('\x1b[?25l');

        this.timer = setInterval(() => {
            this.render();
            this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        }, this.interval);

        return this;
    }

    render() {
        const frame = this.frames[this.frameIndex];
        const elapsed = this.getElapsed();
        const line = `${this.color}${frame}${COLORS.reset} ${this.message} ${COLORS.dim}${elapsed}${COLORS.reset}`;

        // Clear line and write
        this.stream.write(`\r\x1b[K${line}`);
    }

    getElapsed() {
        if (!this.startTime) return '';
        const ms = Date.now() - this.startTime;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) {
            return `(${seconds}s)`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `(${minutes}m ${remainingSeconds}s)`;
    }

    update(message) {
        this.message = message;
        if (this.isSpinning) {
            this.render();
        }
        return this;
    }

    succeed(message) {
        return this.stop(`${COLORS.green}✓${COLORS.reset} ${message || this.message}`);
    }

    fail(message) {
        return this.stop(`${COLORS.yellow}✗${COLORS.reset} ${message || this.message}`);
    }

    info(message) {
        return this.stop(`${COLORS.blue}ℹ${COLORS.reset} ${message || this.message}`);
    }

    stop(finalMessage) {
        if (!this.isSpinning) return this;

        clearInterval(this.timer);
        this.timer = null;
        this.isSpinning = false;

        // Clear line
        this.stream.write('\r\x1b[K');

        // Show cursor
        this.stream.write('\x1b[?25h');

        // Write final message if provided
        if (finalMessage) {
            const elapsed = this.getElapsed();
            this.stream.write(`${finalMessage} ${COLORS.dim}${elapsed}${COLORS.reset}\n`);
        }

        return this;
    }
}

/**
 * Create and start a spinner with a single call
 */
export function createSpinner(message, options = {}) {
    return new Spinner(options).start(message);
}

/**
 * Status line that updates in place (no animation)
 */
export class StatusLine {
    constructor(stream = process.stderr) {
        this.stream = stream;
        this.active = false;
    }

    update(message) {
        if (!this.active) {
            this.active = true;
            this.stream.write('\x1b[?25l'); // Hide cursor
        }
        this.stream.write(`\r\x1b[K${message}`);
        return this;
    }

    clear() {
        if (this.active) {
            this.stream.write('\r\x1b[K');
            this.stream.write('\x1b[?25h'); // Show cursor
            this.active = false;
        }
        return this;
    }

    done(message) {
        this.stream.write(`\r\x1b[K${message}\n`);
        this.stream.write('\x1b[?25h'); // Show cursor
        this.active = false;
        return this;
    }
}

export default Spinner;
