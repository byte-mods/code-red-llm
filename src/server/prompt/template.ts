/**
 * Prompt template that instructs Claude to emit Node-RED nodes as
 * sentinel-delimited JSON inside its text content.
 *
 * Design contract — read this if you are about to change the sentinels or
 * the required-field list:
 *
 *  - The model emits each node as `<NODE>{...}</NODE>` somewhere in its
 *    text output. The extractor (`src/server/extractor/extractor.ts`) scans
 *    `AssistantEvent.content[i].text` for these sentinels and parses the
 *    JSON between them.
 *  - Sentinels are angle-bracket tags chosen because (a) they read like
 *    HTML and the model is comfortable emitting them, (b) they never
 *    appear in valid JSON, (c) the validator additionally requires the
 *    inner content to parse as a JSON object, so any accidental literal
 *    `<NODE>` in prose still gets filtered.
 *  - The required fields here MUST match the validator's required-field
 *    list in `src/server/extractor/validator.ts`. The two are halves of
 *    the same contract — change them together or the model's compliant
 *    output starts failing validation.
 *
 * Determinism: this function is pure. Same input → byte-identical output.
 * This matters because (i) prompt caching at the Anthropic API level keys
 * on prefix bytes, (ii) snapshot tests assert exact output.
 */

/** Open sentinel. Imported by the extractor — single source of truth. */
export const SENTINEL_OPEN = '<NODE>';
/** Close sentinel. Imported by the extractor — single source of truth. */
export const SENTINEL_CLOSE = '</NODE>';
export const SENTINEL_SCHEMA_OPEN = '<SCHEMA>';
export const SENTINEL_SCHEMA_CLOSE = '</SCHEMA>';

/** Optional knobs. All have stable defaults so callers can omit `opts`. */
export interface PromptOptions {
  /**
   * The Node-RED flow (tab) id new nodes should attach to. Defaults to
   * `'flow-main'`, a sentinel value the editor replaces at insert time.
   * Callers running against a real Node-RED instance pass the active tab id.
   */
  readonly flowId?: string;
}

const DEFAULT_FLOW_ID = 'flow-main';

/**
 * Build the full prompt to pass to `spawnClaude({ prompt })`.
 *
 * Structure:
 *   1. System-style preamble (rules, sentinel contract, required fields).
 *   2. Worked example showing one valid node block end-to-end.
 *   3. The user's request, prefixed so the model knows where prompt ends
 *      and user intent begins.
 *
 * The user request is appended verbatim and is NOT escaped. The model is
 * instructed to ignore any sentinel-like text inside the user request —
 * but defence-in-depth lives in the extractor + validator, not here.
 */
export function buildPrompt(userRequest: string, opts: PromptOptions = {}): string {
  const flowId = opts.flowId ?? DEFAULT_FLOW_ID;
  return [
    'You are generating a Node-RED flow from a natural-language request.',
    '',
    'Emit each Node-RED node as a JSON object wrapped in sentinels, exactly:',
    `  ${SENTINEL_OPEN}{ ... }${SENTINEL_CLOSE}`,
    '',
    'Rules:',
    '  - Every node MUST include these fields: id (string), type (string),',
    `    x (number), y (number), z (string, set to "${flowId}"),`,
    '    wires (array of arrays of node id strings, one inner array per output port).',
    '  - Optional fields: name (string), plus any node-type-specific fields',
    '    (url, method, func, topic, payload, …) — pass these through as needed.',
    '  - Emit nodes in dependency order: nodes referenced in another node\'s',
    '    `wires` array MUST appear later in the stream than their referrer is fine,',
    '    but every id used in `wires` MUST eventually appear as some node\'s id.',
    '  - Lay nodes out left-to-right with x spaced ~180px apart, y on a single row',
    '    near 100 unless the flow branches.',
    '  - Output ONE node per sentinel block. Do NOT wrap multiple nodes in one block.',
    '  - You MAY include short prose between sentinel blocks explaining the flow.',
    `  - Do NOT emit the literal text "${SENTINEL_OPEN}" or "${SENTINEL_CLOSE}" anywhere`,
    '    outside an actual node block.',
    '  - For nodes that produce structured output (database result, Kafka record,',
    '    HTTP response, etc.), emit a schema definition:',
    `    ${SENTINEL_SCHEMA_OPEN}{"nodeId":"<id>","fields":{"field":"type",...}}${SENTINEL_SCHEMA_CLOSE}`,
    '  - The nodeId inside a schema block MUST match the id of the node it describes.',
    '  - When structured output flows into a downstream node, insert a `schema`',
    '    node between them. The schema node\'s `definition` MUST match the fields',
    '    from the producer\'s schema block. Example: if the producer schema is',
    '    {"topic":"string","payload":"object"}, the schema node config should be',
    '    {definition:\'{"topic":"string","payload":"object"}\', target:"payload"}.',
    '  - Use `schema` nodes liberally for database, message-bus, and API flows.',
    `  - Do NOT emit the literal text "${SENTINEL_SCHEMA_OPEN}" or "${SENTINEL_SCHEMA_CLOSE}" outside a schema block.`,
    '',
    'Worked example — a single inject → debug flow:',
    '',
    `  ${SENTINEL_OPEN}{"id":"n1","type":"inject","z":"${flowId}","name":"every 30s","props":[{"p":"payload"}],"repeat":"30","x":120,"y":100,"wires":[["n2"]]}${SENTINEL_CLOSE}`,
    `  ${SENTINEL_OPEN}{"id":"n2","type":"debug","z":"${flowId}","name":"log","active":true,"x":320,"y":100,"wires":[]}${SENTINEL_CLOSE}`,
    '',
    'Schema example — a kafka-consumer with typed output and an inline validator:',
    `  ${SENTINEL_SCHEMA_OPEN}{"nodeId":"n3","fields":{"topic":"string","payload":"object"}}${SENTINEL_SCHEMA_CLOSE}`,
    `  ${SENTINEL_OPEN}{"id":"n3","type":"kafka-consumer","z":"${flowId}","name":"orders","x":120,"y":100,"wires":[["n4"]],"brokers":"host:9092","clientId":"c1","groupId":"g1","topic":"orders"}${SENTINEL_CLOSE}`,
    `  ${SENTINEL_OPEN}{"id":"n4","type":"schema","z":"${flowId}","name":"validate-order","x":320,"y":100,"wires":[["n5"]],"definition":"{\\"topic\\":\\"string\\",\\"payload\\":\\"object\\"}","target":"payload","strict":false}${SENTINEL_CLOSE}`,
    `  ${SENTINEL_OPEN}{"id":"n5","type":"debug","z":"${flowId}","name":"log","active":true,"x":520,"y":100,"wires":[]}${SENTINEL_CLOSE}`,
    '',
    'Available custom node types (each registered by the no_code_red plugin —',
    'use these instead of guessing at community module names):',
    '  - postgres            SQL queries against PostgreSQL.',
    '      config: {connectionString:"postgres://…", query?:"SELECT …"}',
    '  - mariadb             SQL queries against MariaDB/MySQL.',
    '      config: {host, port, user, password, database, query?}',
    '  - oraclesql           SQL queries against Oracle Database.',
    '      config: {connectString:"host:1521/SVC", user, password, query?}',
    '  - mongodb             MongoDB operations (find/insertOne/updateOne/deleteOne/aggregate).',
    '      config: {uri, database, collection, operation:"find"}',
    '  - cassandra           Apache Cassandra CQL queries.',
    '      config: {contactPoints:"h1,h2", localDataCenter, keyspace, query?}',
    '  - scylladb            ScyllaDB (Cassandra-compatible) CQL queries.',
    '      config: same as cassandra',
    '  - clickhouse          ClickHouse query or batch insert.',
    '      config: {url:"http://…:8123", username, password, database, operation:"query|insert", query?}',
    '  - redis               Arbitrary Redis command.',
    '      config: {url:"redis://…:6379", command:"GET"}',
    '  - kafka-producer      Sends msg.payload to a Kafka topic.',
    '      config: {brokers:"host:9092,…", clientId, topic}',
    '  - kafka-consumer      Source node — subscribes and emits one msg per record.',
    '      config: {brokers, clientId, groupId, topic, fromBeginning:false}',
    '      Has 0 inputs and 1 output. Put it at the start of a flow.',
    '  - llm                 Inline Claude call inside the flow.',
    '      config: {apiKey?, model:"claude-haiku-4-5", system?, maxTokens:1024}',
    '      Input: msg.prompt (string). Output: msg.payload = response text.',
    '  - sqlite              Embedded SQL via better-sqlite3 (file or :memory:).',
    '      config: {file:":memory:" | "/path/to.db", query?}',
    '  - elasticsearch       Elasticsearch operations (search/index/get/delete).',
    '      config: {node:"http://…:9200", username?, password?, index, operation}',
    '  - opensearch          OpenSearch — same operation set as elasticsearch.',
    '      config: same as elasticsearch',
    '  - neo4j               Graph DB; Cypher queries.',
    '      config: {url:"bolt://…:7687", user, password, database?, query?}',
    '  - influxdb            Time-series DB.',
    '      config: {url, token, org, bucket, operation:"write|query"}',
    '      write: msg.measurement + msg.fields + msg.tags. query: msg.query (Flux).',
    '  - etcd                Distributed KV (Kubernetes backend).',
    '      config: {hosts:"h1:2379,h2:2379", operation:"get|put|delete"}',
    '  - qdrant              Vector DB (REST).',
    '      config: {url, apiKey?, collection, operation:"search|upsert|delete"}',
    '  - weaviate            Vector DB.',
    '      config: {host:"host:8080", apiKey?, className, operation:"search|insert|delete"}',
    '  - rabbitmq            AMQP 0-9-1.',
    '      config: {url, exchange?, queue, operation:"publish|consume"}',
    '      consume → source node (0 inputs / 1 output).',
    '  - nats                Lightweight pub/sub.',
    '      config: {servers, subject, operation:"publish|subscribe"}',
    '      subscribe → source node.',
    '  - s3                  AWS S3 / MinIO via endpoint override.',
    '      config: {endpoint?, region, accessKeyId, secretAccessKey, bucket, operation}',
    '      operation: getObject | putObject | deleteObject | listObjects',
    '  - graphql             Generic GraphQL HTTP client.',
    '      config: {endpoint, authHeader?, query?}',
    '  - prometheus          Push a metric to a Pushgateway.',
    '      config: {url, job, instance?, metric}',
    '      msg.value (number) + msg.labels.',
    '  - scheduler           Source node — fire on interval or cron.',
    '      config: {mode:"interval|cron", intervalMs?, cron?, payload?}',
    '      0 inputs / 1 output. Replaces inject for time-driven sources.',
    '  - window-aggregate    Stateful CEP — window + group-by + aggregate.',
    '      config: {windowType:"tumbling|sliding|session", windowMs, slideMs?, sessionGapMs?,',
    '               keyField?, valueField?, op:"count|sum|avg|min|max|first|last"}',
    '      Emits one msg per closed window with msg.payload=aggregate, msg.count, msg.key.',
    '  - stream-join         Equi-join two streams on a shared key, within a window.',
    '      config: {keyField, windowMs}',
    '      Upstream msgs MUST set msg.stream="left" or "right". Emits msg.payload={left,right}.',
    '  - pattern-match       Detect event sequence per key within a window.',
    '      config: {sequence:"a,b,c", keyField, eventField?, windowMs}',
    '      Emits msg.payload = chain of matched payloads in order.',
    '  - dedupe              Drop duplicates within a TTL window.',
    '      config: {keyField?, ttlMs, maxSize}',
    '  - gate                Conditional pass-through; controlled by msg.control.',
    '      config: {initial:"open|closed"}; control msgs: msg.control="open|close|toggle".',
    '  - metronome           Rate limiter / pacer.',
    '      config: {ratePerSec, mode:"drop|queue|tick", queueCap}',
    '  - schema              Strongly-typed wire enforcement (StreamBase-style tuple contract).',
    '      config: {definition:"{\\"field\\":\\"type\\",...}", target:"payload", strict:false}',
    '      Types: string|number|integer|boolean|object|array|null|any (suffix "?" = optional).',
    '      TWO outputs: port 1 = valid pass-through; port 2 = invalid + msg.errors.',
    '      Insert between source and sink whenever a downstream node has a stable contract.',
    '  - tracer              Step-through debugger on a wire (pass-through unless paused).',
    '      config: {initialMode:"running|paused"}',
    '      Sidebar Trace panel offers Pause/Step/Resume controls per tracer instance.',
    '      Default to NOT inserting one unless the user explicitly asks for debug control.',
    '',
    'For built-in Node-RED nodes (inject, debug, function, http in, http request,',
    'switch, change, template, mqtt in, mqtt out, etc.) use their canonical types.',
    'Prefer the custom types above when the flow needs database, message-bus,',
    'or LLM steps — they are guaranteed to load in this environment.',
    '',
    'End of rules. The user\'s request follows.',
    '',
    'User request:',
    userRequest,
  ].join('\n');
}
