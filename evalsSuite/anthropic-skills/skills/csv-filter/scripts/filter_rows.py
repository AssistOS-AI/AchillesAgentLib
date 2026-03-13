import csv
import sys


def main():
    if len(sys.argv) < 5:
        print(
            "Usage: filter_rows.py <input_csv> <output_csv> <column_name> <min_value>",
            file=sys.stderr,
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    column_name = sys.argv[3]
    min_value = float(sys.argv[4])

    with open(input_path, newline="", encoding="utf-8") as infile:
        reader = csv.DictReader(infile)
        headers = reader.fieldnames or []
        if column_name not in headers:
            print(f"Column not found: {column_name}", file=sys.stderr)
            sys.exit(2)

        rows = list(reader)

    kept = []
    for row in rows:
        value = row.get(column_name, "").strip()
        if value:
            try:
                if float(value) >= min_value:
                    kept.append(row)
            except ValueError:
                print(f"Non-numeric value in {column_name}: {value}", file=sys.stderr)
                sys.exit(3)

    with open(output_path, "w", newline="", encoding="utf-8") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=headers)
        writer.writeheader()
        writer.writerows(kept)

    print(f"kept: {len(kept)}")
    print(f"removed: {len(rows) - len(kept)}")


if __name__ == "__main__":
    main()
