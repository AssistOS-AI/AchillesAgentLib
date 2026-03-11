import csv
import sys


def main():
    if len(sys.argv) < 4:
        print(
            "Usage: sum_column.py <input_csv> <output_csv> <column_name>",
            file=sys.stderr,
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    column_name = sys.argv[3]

    with open(input_path, newline="", encoding="utf-8") as infile:
        reader = csv.DictReader(infile)
        headers = reader.fieldnames or []
        if column_name not in headers:
            print(f"Column not found: {column_name}", file=sys.stderr)
            sys.exit(2)

        rows = list(reader)

    total = 0.0
    for row in rows:
        value = row.get(column_name, "").strip()
        if value:
            try:
                total += float(value)
            except ValueError:
                print(f"Non-numeric value in {column_name}: {value}", file=sys.stderr)
                sys.exit(3)

    output_rows = rows[:]
    total_row = {key: "" for key in headers}
    total_row[headers[0]] = "Totals"
    total_row[column_name] = str(int(total) if total.is_integer() else total)
    output_rows.append(total_row)

    with open(output_path, "w", newline="", encoding="utf-8") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=headers)
        writer.writeheader()
        writer.writerows(output_rows)

    print(total_row[column_name])


if __name__ == "__main__":
    main()
