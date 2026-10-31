"""Parse explicit SQL inputs with the separate validator environment, never a database."""
from pathlib import Path
import re
import sys

from sqlfluff.core import FluffConfig, Linter


def main():
    dialect, *paths = sys.argv[1:]
    if not paths:
        raise ValueError('No SQL files supplied.')
    for name in paths:
        source = Path(name).read_text(encoding='utf-8-sig')
        if re.search(r'--\s*sqlfluff\s*:', source, re.I):
            raise ValueError(name + ': inline SQLFluff settings are unsupported; set sql_dialect in .law-verification.json.')
        # No local configuration, ignored paths, templating, or large-file skipping.
        config = FluffConfig(overrides={'dialect': dialect, 'templater': 'raw',
                                      'large_file_skip_byte_limit': 0, 'large_file_skip_char_limit': 0})
        parsed = Linter(config=config).parse_string(source, fname=name)
        if parsed.violations:
            raise ValueError(name + ': ' + '\n'.join(str(error) for error in parsed.violations))
        print('SQL grammar passed: ' + name, flush=True)
    print('No database connection or SQL execution occurred.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('SQL verification failed: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
