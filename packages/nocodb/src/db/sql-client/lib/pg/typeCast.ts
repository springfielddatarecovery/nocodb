import { UITypes } from 'nocodb-sdk';
import { DATE_FORMATS, TIME_FORMATS } from '~/db/sql-client/lib/pg/constants';

/*
 * Generate query to extract number from a string. The number is extracted by
 * removing all non-numeric characters from the string. Decimal point is allowed.
 * If there are more than one decimal points, only the first one is considered, the rest are ignored.
 *
 * @param {String} source - source column name
 * @returns {String} - query to extract number from a string
 */
function extractNumberQuery(source: string) {
  return `
    CAST(
      NULLIF(
        REPLACE(
          REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(${source}, '[^0-9.]', '', 'g'), 
              '(\\d)\\.', '\\1-'
            ), 
            '.', ''
          ), 
          '-', '.'
        ), ''
      ) AS DECIMAL
    )
  `;
}

/*
 * Generate query to cast a value to boolean. The boolean value is determined based on the given mappings.
 *
 * @param {String} columnName - Source column name
 * @returns {String} - query to cast value to boolean
 */
function generateBooleanCastQuery(columnName: string): string {
  return `
    CASE
      WHEN ${columnName} IN ('checked', 'x', 'yes', 'y', '1', '[x]', '☑', '✅', '✓', '✔', 'enabled', 'on', 'done', 'true') THEN true
      WHEN ${columnName} IN ('unchecked', '', 'no', 'n', '0', '[]', '[ ]', 'disabled', 'off', 'false') THEN false
      ELSE null
    END;
  `;
}

/*
 * Generate query to cast a value to single select. The single select value is
 * determined based on the given options.
 *
 * @param {String} columnName - Source column name
 * @param {String[]} options - Single select options
 * @returns {String} - query to cast value to single select
 */
function generateSingleSelectCastQuery(
  columnName: string,
  options: string[],
): string {
  return `CASE 
    WHEN ${columnName} IN (${options
    .map((option) => `'${option}'`)
    .join(',')}) THEN ${columnName}
    ELSE NULL
    END;`;
}

/*
 * Generate query to cast a value to date based on the given format.
 *
 * @param {String} source - Source column name
 * @param {String} format - Date format
 * @returns {String} - query to cast value to date
 */
function generateDateCastQuery(source: string, format: string) {
  if (!(format in DATE_FORMATS)) {
    throw new Error(`Invalid date format: ${format}`);
  }

  const cases = DATE_FORMATS[format].map(
    ([format, regex]) =>
      `WHEN ${source} ~ '${regex}' THEN TO_DATE(${source}, '${format}')`,
  );

  return `CASE 
    ${cases.join('\n')}
    ELSE NULL
   END;`;
}

/*
 * Generate query to cast a value to date time based on the given date and time formats.
 *
 * @param {String} source - Source column name
 * @param {String} dateFormat - Date format
 * @param {String} timeFormat - Time format
 * @returns {String} - query to cast value to date time
 */
function generateDateTimeCastQuery(source: string, dateFormat: string) {
  if (!(dateFormat in DATE_FORMATS)) {
    throw new Error(`Invalid date format: ${dateFormat}`);
  }

  const cases = DATE_FORMATS[dateFormat].map(([format, regex]) =>
    TIME_FORMATS.map(
      ([timeFormat, timeRegex]) =>
        `WHEN ${source} ~ '${regex.slice(0, -1)} ${timeRegex.slice(
          1,
        )}' THEN TO_TIMESTAMP(${source}, '${format} ${timeFormat}')`,
    ).join('\n'),
  );

  return `CASE 
    ${cases.join('\n')}
    ELSE NULL
   END;`;
}

/*
 * Generate query to cast a value to time based on the given time formats.
 *
 * @param {String} source - Source column name
 * @returns {String} - query to cast value to time
 */
function generateTimeCastQuery(source: string) {
  const cases = TIME_FORMATS.map(
    ([format, regex]) =>
      `WHEN ${source} ~ '${regex}' THEN TO_TIMESTAMP(${source}, '${format}')`,
  );

  return `CASE 
    ${cases.join('\n')}
    ELSE NULL
   END;`;
}

/*
 * Generate query to cast a value to duration. The duration is determined based on the given formats.
 *
 * @param {String} source - Source column name
 * @returns {String} - query to cast value to duration
 */
function generateDurationCastQuery(source: string) {
  return `CASE 
    WHEN ${source} ~ '\\d+' THEN CAST(${source} as DECIMAL) 
    ${Object.keys(TIME_FORMATS)
      .map(
        (format) =>
          `WHEN ${source} ~ '${TIME_FORMATS[format]}' THEN 
            EXTRACT(EPOCH FROM TO_TIMESTAMP(${source}, '${format}'))`,
      )
      .join('\n')}
    ELSE NULL
   END;`;
}

/*
 * Generate SQL script to transform a multi-select VARCHAR column to a filtered text field in PostgreSQL using regex.
 *
 * @param {String} columnName - The name of the column to be transformed.
 * @param {String[]} options - Array of valid options.
 * @returns {String} - SQL script to transform the column using regex.
 */
function generateMultiSelectCastQuery(columnName: string, options: string[]) {
  // Escape special characters in options and join them with the regex OR operator
  const escapedOptions = options.map((opt) =>
    opt.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
  );

  return `
    NULLIF(
      REGEXP_REPLACE(
        ${columnName},
        '((^|,)(\\?!(${escapedOptions.join('|')})($|,))[^,]*)',
        '',
        'g'
      ),
      ''
    );
  `;
}

/*
 * Generate SQL query to extract a number from a string and make out-of-bounds values NULL.
 *
 * @param {String} source - Source column name.
 * @param {Number} minValue - Minimum allowed value.
 * @param {Number} maxValue - Maximum allowed value.
 * @returns {String} - SQL query to extract number and handle out-of-bounds values.
 */
function generateNumberBoundingQuery(
  source: string,
  minValue: number,
  maxValue: number,
) {
  return `
  NULLIF(
    NULLIF(
      LEAST(
        ${maxValue + 1}, GREATEST(${minValue - 1}, ${source})
      ), ${minValue - 1}
    ), ${maxValue + 1}
  );
`;
}

/*
 * Generate query to cast a column to a specific data type based on the UI data type.
 *
 * @param {UITypes} uidt - UI data type
 * @param {String} source - Source column name
 * @param {Number} limit - Limit for the data type
 * @param {String} dateFormat - Date format
 * @param {String} timeFormat - Time format
 * @returns {String} - query to cast column to a specific data type
 */
export function generateCastQuery(
  uidt: UITypes,
  source: string,
  limit: number,
  dateFormat = 'dmy',
  options: string[] = [],
) {
  switch (uidt) {
    case UITypes.LongText:
      return `${source}::TEXT;`;
    case UITypes.SingleLineText:
    case UITypes.Email:
    case UITypes.PhoneNumber:
    case UITypes.URL:
      return `${source}::VARCHAR(${limit || 255});`;
    case UITypes.Number:
      return `CAST(${extractNumberQuery(source)} AS BIGINT);`;
    case UITypes.Year:
      return generateNumberBoundingQuery(
        extractNumberQuery(source),
        1000,
        9999,
      );
    case UITypes.Decimal:
    case UITypes.Currency:
      return `${extractNumberQuery(source)};`;
    case UITypes.Percent:
      return `LEAST(100, GREATEST(0, ${extractNumberQuery(source)}));`;
    case UITypes.Rating:
      return `LEAST(${limit || 5}, GREATEST(0, ${extractNumberQuery(
        source,
      )}));`;
    case UITypes.Checkbox:
      return generateBooleanCastQuery(source);
    case UITypes.Date:
      return generateDateCastQuery(source, dateFormat);
    case UITypes.DateTime:
      return generateDateTimeCastQuery(source, dateFormat);
    case UITypes.Time:
      return generateTimeCastQuery(source);
    case UITypes.Duration:
      return generateDurationCastQuery(source);
    case UITypes.SingleSelect:
      return generateSingleSelectCastQuery(source, options);
    case UITypes.MultiSelect:
      return generateMultiSelectCastQuery(source, options);
    default:
      throw new Error(`Data type conversion not implemented for: ${uidt}`);
  }
}

/*
 * Generate query to format a column based on the UI data type.
 *
 * @param {String} columnName - Column name
 * @param {UITypes} uiDataType - UI data type
 * @returns {String} - query to format a column
 */
export function formatColumn(columnName: string, uiDataType: UITypes) {
  switch (uiDataType) {
    case UITypes.LongText:
    case UITypes.SingleLineText:
    case UITypes.MultiSelect:
    case UITypes.Email:
    case UITypes.URL:
    case UITypes.SingleSelect:
    case UITypes.PhoneNumber:
      return `"${columnName}"`;
    case UITypes.Number:
    case UITypes.Decimal:
    case UITypes.Currency:
    case UITypes.Percent:
    case UITypes.Rating:
    case UITypes.Duration:
    case UITypes.Year:
      return `CAST("${columnName}" AS VARCHAR(255))`;
    case UITypes.Checkbox:
      return `CAST(CASE WHEN "${columnName}" THEN '1' ELSE '0' END AS TEXT)`;
    case UITypes.Date:
    case UITypes.DateTime:
    case UITypes.Time:
      return `CAST("${columnName}" AS TEXT)`;
    default:
      return `CAST("${columnName}" AS TEXT)`;
  }
}