import sys
import re


def main():
    if len(sys.argv) < 2:
        print("Usage: text_stats.py <input_file>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]

    with open(input_path, encoding="utf-8") as f:
        text = f.read()

    # Character count (excluding leading/trailing whitespace)
    text = text.strip()
    characters = len(text)

    # Word count
    words_list = text.split()
    words = len(words_list)

    # Sentence count (split on .!?)
    sentences = len(re.findall(r'[.!?]+', text))
    if sentences == 0 and words > 0:
        sentences = 1

    # Average word length
    if words > 0:
        avg_word_length = round(sum(len(w.strip(".,!?;:\"'()")) for w in words_list) / words, 1)
    else:
        avg_word_length = 0.0

    print(f"words: {words}")
    print(f"sentences: {sentences}")
    print(f"characters: {characters}")
    print(f"avg_word_length: {avg_word_length}")


if __name__ == "__main__":
    main()
