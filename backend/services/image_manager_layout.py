"""Output geometry with optional fitting/paging and codec-specific edge limits."""
import math
from statistics import median


def ordered(records, options):
    records = list(records)
    order = options.get('order', 'filename')
    if order == 'shuffle':
        seed = options.get('shuffle_seed', 1)
        for index in range(len(records) - 1, 0, -1):
            seed = (1664525 * seed + 1013904223) & 0xffffffff
            other = seed % (index + 1)
            records[index], records[other] = records[other], records[index]
    elif order == 'reverse' or options.get('reverse'):
        records.reverse()
    return records


def output_side(options, limits):
    # Actual encoder limits, not a generic megapixel cap.
    return {'webp': 16383, 'jpg': 65500}.get(options.get('format'), limits['max_stitched_side'])


def grid_shape(count, options):
    if options['layout'] == 'horizontal': return count
    if options['layout'] == 'vertical': return 1
    return min(count, options.get('columns') or max(1, math.ceil(math.sqrt(count * options['height'] / options['width']))))


def fits(width, height, options, limits):
    side = output_side(options, limits)
    if options.get('size_mode', 'exact') == 'exact': return max(width, height) <= side
    return max(width, height) <= min(side, limits['fit_canvas_side']) and width * height <= limits['fit_canvas_pixels']


def regular_sheet(records, options, limits):
    count = len(records)
    columns = grid_shape(count, options)
    rows = math.ceil(count / columns)
    gap, width, height = options['gap'], options['width'], options['height']

    def geometry(scale):
        w, h = max(1, math.floor(width * scale)), max(1, math.floor(height * scale))
        return w, h, columns * w + (columns - 1) * gap, rows * h + (rows - 1) * gap

    w, h, cw, ch = geometry(1)
    if not fits(cw, ch, options, limits):
        if options.get('size_mode', 'exact') == 'exact':
            raise ValueError('The stitched image exceeds this format\'s edge limit. Choose PNG, Fit into one image or Multiple sheets.')
        if not fits(*geometry(0)[2:], options, limits):
            raise ValueError('The spacing alone exceeds the output size. Reduce the gap or choose Multiple sheets.')
        low, high = 0.0, 1.0
        for _ in range(48):
            scale = (low + high) / 2
            if fits(*geometry(scale)[2:], options, limits): low = scale
            else: high = scale
        w, h, cw, ch = geometry(low)
    return dict(width=cw, height=ch, columns=columns, rows=rows, tile_width=w, tile_height=h,
                reduced=w < width or h < height,
                placements=[dict(id=item['id'], x=(i % columns) * (w + gap), y=(i // columns) * (h + gap), width=w, height=h) for i, item in enumerate(records)])


def balanced_rows(records, columns):
    groups = [[], [], []]
    for item in records:
        ratio = item['width'] / item['height']
        groups[0 if ratio > 1.05 else 1 if ratio < 1 / 1.05 else 2].append(item)
    density = columns
    while True:
        result = []
        for group in groups:
            if not group: continue
            ratio = median(item['width'] / item['height'] for item in group)
            capacity = max(1, math.floor(density / math.sqrt(ratio) + 0.5))
            row_count = max(1, math.ceil(len(group) / capacity))
            if capacity >= 2: row_count = min(row_count, max(1, len(group) // 2))
            base, extra = divmod(len(group), row_count)
            offset = 0
            for index in range(row_count):
                length = base + int(index < extra)
                result.append(group[offset:offset + length]); offset += length
        areas = []
        for row in result:
            ratios = [item['width'] / item['height'] for item in row]
            denominator = sum(ratios) ** 2
            areas.extend(ratio / denominator for ratio in ratios)
        if max(areas) <= 3 * median(areas) or density == 1: return result, density
        # Sparse orientation groups must not become giant billboards. Adapt
        # density for the whole compilation instead of dropping any sources.
        density = max(1, math.floor(density * 0.75))


def balanced_sheet(records, options, limits):
    columns = grid_shape(len(records), options)
    rows, columns = balanced_rows(records, columns)
    rows = ordered(rows, options)
    minimum = max(len(row) for row in rows)
    requested = max(minimum, columns * options['width'])

    def heights(width):
        return [max(1, math.floor(width / sum(item['width'] / item['height'] for item in row) + 0.5)) for row in rows]

    width = requested
    if not fits(width, sum(heights(width)), options, limits):
        if options.get('size_mode', 'exact') == 'exact':
            raise ValueError('The full-fill canvas exceeds this format\'s edge limit. Choose PNG, Fit into one image or Multiple sheets.')
        if not fits(minimum, sum(heights(minimum)), options, limits):
            raise ValueError('This layout cannot fit at one pixel per image. Choose Multiple sheets.')
        low, high = minimum, requested
        while low < high:
            mid = (low + high + 1) // 2
            if fits(mid, sum(heights(mid)), options, limits): low = mid
            else: high = mid - 1
        width = low
    placements, y = [], 0
    for row, height in zip(rows, heights(width)):
        ratios = [item['width'] / item['height'] for item in row]
        # Reserve a pixel per image, then distribute the remaining width.
        usable = width - len(row)
        ideals = [usable * ratio / sum(ratios) for ratio in ratios]
        widths = [1 + math.floor(value) for value in ideals]
        remaining = width - sum(widths)
        priority = sorted(range(len(row)), key=lambda i: (-(ideals[i] - math.floor(ideals[i])), i))
        for index in priority[:remaining]: widths[index] += 1
        x = 0
        for item, draw_width in zip(row, widths):
            placements.append(dict(id=item['id'], x=x, y=y, width=draw_width, height=height))
            x += draw_width
        y += height
    return dict(width=width, height=y, columns=columns, rows=len(rows), reduced=width < requested, placements=placements)


def plan(records, options, limits):
    if not records: raise ValueError('Choose available catalog images.')
    if options['layout'] in ('none', 'gif'): return []
    build = balanced_sheet if options['layout'] == 'balanced' else regular_sheet
    if options.get('size_mode', 'exact') != 'pages': return [build(records, options, limits)]
    per_sheet = options.get('images_per_sheet', 60)
    page_options = dict(options)
    if options['layout'] != 'balanced':
        columns = grid_shape(min(len(records), per_sheet), options)
        width, height, gap = options['width'], options['height'], options['gap']
        side = min(output_side(options, limits), limits['fit_canvas_side'])
        if options['layout'] == 'horizontal': columns = min(columns, max(1, (side + gap) // (width + gap)), max(1, math.floor((limits['fit_canvas_pixels'] / height + gap) / (width + gap))))
        elif not options.get('columns') and options['layout'] != 'vertical':
            columns = min(columns, max(1, (side + gap) // (width + gap)), max(1, math.floor((limits['fit_canvas_pixels'] / height + gap) / (width + gap))))
        cw = columns * width + (columns - 1) * gap
        maximum_rows = min((side + gap) // (height + gap), math.floor((limits['fit_canvas_pixels'] / cw + gap) / (height + gap)))
        if cw > side or maximum_rows < 1:
            raise ValueError('A sheet cannot fit these tile dimensions and columns. Reduce dimensions or columns.')
        capacity = min(per_sheet, columns * maximum_rows)
        if options['layout'] == 'horizontal': capacity = min(capacity, columns)
        per_sheet = capacity
        page_options['columns'] = columns
        page_options['size_mode'] = 'exact'
    else:
        # Full-fill sheets keep all aspect ratios; adapt each canvas to its mix.
        page_options['size_mode'] = 'fit'
    return [build(records[index:index + per_sheet], page_options, limits) for index in range(0, len(records), per_sheet)]
