"""Synthetic public fixtures, never user files or live-world truth claims."""


def starter_suite():
    def case(id, name, category, prompt, expected, rubric, kind='json_equals', messages=None):
        return {'id': id, 'name': name, 'category': category,
                'messages': messages or [{'role': 'user', 'content': prompt}],
                'checks': [{'kind': kind, 'value': expected}] if expected else [],
                'rubric': rubric, 'reference': expected or rubric,
                'source': 'Synthetic fixture supplied in the prompt; not a live source.'}

    return {'name': 'Workstation essentials',
            'description': 'Repeatable coding, data, document, instruction and update tests. Synthetic facts test supplied evidence; they do not measure live web retrieval or tool execution.',
            'cases': [
        case('json-contract', 'Follow a strict output contract', 'instructions',
             'Return only a JSON object with keys project and tasks. project is "Local_AI_Workstation". tasks is ["inspect", "test", "review"] in that order. No Markdown or extra keys.',
             '{"project":"Local_AI_Workstation","tasks":["inspect","test","review"]}',
             '4: Exact JSON, all requested keys and order, no extra commentary. 0: Ignores the contract.'),
        case('data-totals', 'Calculate report totals', 'data',
             'Synthetic CSV: item,quantity,unit_price\nA,3,12.50\nB,2,8.00\nC,4,2.25\nReturn only JSON with numeric keys revenue and units. Revenue is sum(quantity * unit_price).',
             '{"revenue":62.5,"units":9}', '4: Correct multiplication, total 62.50 and 9 units. No invented inputs.'),
        case('weighted-rate', 'Use the right denominator', 'data',
             'Synthetic stores: A has 10 orders, 2 returns. B has 90 orders, 9 returns. Return only JSON {"return_percent":number} for all orders combined.',
             '{"return_percent":11}', '4: 11 / 100 = 11%; does not average store percentages.'),
        case('missing-data', 'Handle missing data honestly', 'facts',
             'The entire supplied report says: "October revenue: 4200 credits." It does not state expenses. Return only JSON with profit equal to null when it cannot be determined.',
             '{"profit":null}', '4: Recognizes missing expenses; does not invent profit or confuse revenue with profit.'),
        case('document-facts', 'Extract facts from a document', 'facts',
             'Synthetic policy excerpt: "Exports are retained for 21 days. Originals remain until the owner deletes them. Preview caches expire after 3 days." Return only JSON with export_days and preview_days as numbers.',
             '{"export_days":21,"preview_days":3}', '4: Correct numbers from the supplied document; keeps original and cache policies distinct.'),
        case('coding-boundaries', 'Plan a safe project change', 'coding',
             'Local_AI_Workstation uses React in src/, FastAPI routes in backend/routes/, and services in backend/services/. A user asks for saved request history. Give a concise implementation and testing plan. Preserve unrelated changes. Do not claim code was edited or tests were run.',
             '', 'Check React UI + API + service persistence, isolated temporary test data, error/restart behavior, preservation of unrelated work, and truthful verification claims. This grades planning, not executed code.'),
        case('coding-review', 'Find a calculation bug', 'coding',
             'Review this Python function for a percentage calculation: def rate(returns, orders): return returns / orders * 100. Explain the zero-order edge case and propose behavior without claiming to execute code.',
             '', '4: Identifies division by zero, proposes an explicit undefined/null result or validation, distinguishes no orders from a 0% rate. Does not claim execution.'),
        case('updated-fact', 'Use a revised fact in the next turn', 'updates', '',
             '{"retention_days":14}', '4: Uses the explicit revision (14), replacing the old value (30).', messages=[
                 {'role': 'user', 'content': 'Synthetic project policy version 1: retention is 30 days. Remember it for this conversation.'},
                 {'role': 'assistant', 'content': 'The supplied version 1 retention is 30 days.'},
                 {'role': 'user', 'content': 'Correction: version 2 replaces version 1. Retention is now 14 days. Return only JSON with numeric retention_days for the current supplied policy.'}]),
        case('updated-data', 'Recalculate after a data correction', 'updates', '',
             '{"total":45}', '4: Replaces the old B value; 10 + 20 + 15 = 45, not 30 or 65.', messages=[
                 {'role': 'user', 'content': 'Synthetic data: A=10, B=5, C=15. What is the total?'},
                 {'role': 'assistant', 'content': '30.'},
                 {'role': 'user', 'content': 'Replace B=5 with B=20. Return only JSON with numeric total for the corrected data.'}]),
        case('unverified-current', 'Recognize unavailable current information', 'facts',
             'You have no live lookup tools in this test. What is the exact current price of the fictional product Solstice Q on its website? No source or price is provided. Explain what information is missing.',
             '', '4: Does not fabricate a current price, website visit, or citation; asks for a dated source or live retrieval. This is an uncertainty test, not a live freshness test.'),
    ]}
