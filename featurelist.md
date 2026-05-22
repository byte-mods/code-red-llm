# TIBCO StreamBase / TIBCO Streaming — Detailed Feature List

*Compiled from TIBCO official documentation (7.6.x – 11.2.x) and technical reference materials.*

---

## 1. Core Platform & Architecture

| Feature | Description |
|---|---|
| **Stream-Relational Model** | Processes inbound data while it is in flight; queries are stored and stream data runs through them (database turned upside down). |
| **Event-Driven Engine** | Native continuous processing of individual events as they arrive (not micro-batch). |
| **StreamBase Server** | Ultra-low latency, high-throughput C++ application server optimized for real-time streaming event data. |
| **Multi-Threaded Runtime** | Parallel tuple processing across CPU cores with configurable parallel regions. |
| **Clustering** | Horizontal scaling across multiple nodes; vertical scaling on large multicore machines (24+, 32+ cores). |
| **64-Bit Support** | Large memory support (10s of gigabytes) on 64-bit Linux, Windows, and Solaris. |
| **Hardware Acceleration** | Support for GPU, Solace, and Tervela hardware acceleration. |
| **Page Pool Memory** | Dedicated memory pool for tuples flowing between operators. |

---

## 2. Development Environment — StreamBase Studio

| Feature | Description |
|---|---|
| **Eclipse-Based IDE** | Full Eclipse platform (now Eclipse 4.34 in Streaming 11.2); three perspectives: SB Authoring, SB Test/Debug, SB Demos. |
| **EventFlow Visual Editor** | Drag-and-drop graphical dataflow language (XML-based `.sbapp` files). |
| **StreamSQL Editor** | Text-based continuous query language (`.ssql` files) with Content Assist and live syntax checking. |
| **Bi-Directional Conversion** | Convert EventFlow `.sbapp` files to StreamSQL `.ssql` and vice versa. |
| **Visual Diff/Merge** | Source-control merge and diff operations rendered in the visual editor. |
| **Outline View** | Hierarchical view distinguishing Query Tables, JDBC Tables, Query operator types (Read/Write/Delete). |
| **Keyboard Shortcuts** | Rapid operator placement (e.g., `Q R` = Query-Read, `Q W` = Query-Write, `Q D` = Query-Delete). |
| **Hyperlinks** | URLs in text editors become clickable hyperlinks. |
| **Command Shell Integration** | Open StreamBase Command Prompt / Shell directly from IDE. |
| **Samples & Tutorials** | 10 built-in demos + 150 sample applications across 12 categories. |

---

## 3. Programming Models

| Feature | Description |
|---|---|
| **EventFlow** | Visual, stream-relational programming with operators, streams, arcs, and data constructs. |
| **StreamSQL** | SQL-like declarative language for streaming queries (`SELECT ... FROM STREAM`, `FROM PATTERN`, etc.). |
| **Modules** | Reusable sub-applications referenced as single components inside larger applications. |
| **Application Modules** | Any EventFlow/StreamSQL file can become a module if schema and functions are compatible. |
| **Parameters** | Pass configuration values at runtime for properties not known at design time. |
| **Extension Points** | Declared interfaces for module extension and substitution. |

---

## 4. Type System & Schema

| Feature | Description |
|---|---|
| **Strongly-Typed Tuples** | Every stream has a strict schema; fields have declared data types. |
| **Supported Data Types** | `int`, `long`, `double`, `string`, `timestamp`, `blob`, `list<T>`, `tuple`, `bool`, nullable variants. |
| **Schema Definition** | Define schemas inline, via imported modules, or from external sources (JDBC, etc.). |
| **Type Coercion & Conversion** | Automatic and explicit casting rules between compatible types. |
| **Nullable Types** | Fields can be marked nullable; null handling in expressions. |
| **Escaped Identifiers** | Syntax for field names that conflict with reserved words. |
| **Wildcard Rules** | `*` and `**` expansion in `SELECT` target lists. |

---

## 5. Operators (EventFlow Palette)

| Operator | Function |
|---|---|
| **Input Stream / Output Stream** | Source and sink of event data. |
| **Filter** | Route tuples based on boolean predicates; multi-port output. |
| **Map** | Transform fields, add/remove fields, compute expressions. |
| **Aggregate** | Apply aggregate functions over windows; group-by; multi-dimension support. |
| **Join** | Stream-stream equi-joins and interval joins. |
| **Union** | Merge multiple streams of identical schema into one. |
| **Gather** | Collect tuples from multiple streams into a single composite tuple. |
| **Query** | Read, Write, or Delete against Query Tables or JDBC Tables. |
| **Pattern** | Complex event pattern matching across one or more streams. |
| **Lock / Unlock** | Exclusive processing of tuples matching a key set. |
| **Heartbeat / Metronome** | Inject time-based or interval-based control tuples. |
| **Java Operator** | Embed custom Java logic as a first-class operator. |
| **Adapter Operators** | Embedded input/output adapters running in-server. |

---

## 6. Windowing & Aggregation

| Feature | Description |
|---|---|
| **Window Types** | Time-based, count-based, field-range based. |
| **Window Kinds** | Tumbling (fixed, non-overlapping), sliding/hopping (overlapping), session (inactivity gap). |
| **Multi-Dimension Windows** | A single Aggregate operator can define multiple dimensions. |
| **Window Metadata Functions** | `getWindowID()`, `getOldestWindowID()`, `isOldestWindow()`, `openval()`, `closeval()`. |
| **Aggregate Functions** | `count`, `sum`, `avg`, `min`, `max`, `firstval`, `lastval`, `firstnonnullval`, `lastnonnullval`, `firstn()`, `lastn()`, `lag()`, `stddev`, `variance`. |
| **Grouped Aggregation** | Group-by one or more fields with independent windows per key. |
| **Materialized Windows** | Persisted or cached window views for query access. |

---

## 7. Pattern Matching & CEP

| Feature | Description |
|---|---|
| **Pattern Operator** | Detect sequences, absences, and temporal relationships across streams. |
| **StreamSQL Pattern Clause** | `SELECT ... FROM PATTERN` syntax for pattern queries. |
| **Pattern Language** | Express complex event chains: A followed by B within N seconds, then not C. |
| **Multi-Stream Patterns** | Correlate events arriving on different input streams. |
| **Temporal Constraints** | Time bounds on pattern completion and inter-event gaps. |

---

## 8. Query Tables & State Management

| Feature | Description |
|---|---|
| **Query Tables** | In-memory or persisted table constructs associated with Query operators. |
| **CRUD Operations** | Read (with predicates), Write (insert/update), Delete (with predicates). |
| **Indexes** | Primary and secondary indexes for fast keyed lookups. |
| **JDBC Tables** | External database-backed tables queryable from EventFlow. |
| **Table-Stream Joins** | Enrich streaming data with table lookups. |
| **State Replication** | HA configurations replicate table state across nodes. |

---

## 9. Connectors / Adapters

### Standard / General-Purpose
- Bidirectional Socket (raw, BLOB, CSV, JSON, Serialized Tuple)
- File I/O (Binary, CSV, XML, Regex, Monitor, Writer)
- HTTP Client / Web Server Request & Response
- WebSocket Client
- UDP Receiver / Sender
- FTP Operator
- Email (SMTP / POP3 / SMPP)
- RSS Reader
- LDAP
- SNMP Input
- Syslog Input
- Task Scheduler
- Google Protocol Buffers
- RTPP
- Slack, Twitter, Wikimedia EventStreams

### TIBCO Ecosystem
- TIBCO Rendezvous
- TIBCO Enterprise Message Service (EMS)
- TIBCO FTL (Fast Transfer Layer) — Input & Output
- TIBCO eFTL
- TIBCO ActiveSpaces
- TIBCO ActiveMatrix BPM
- TIBCO Spotfire / Spotfire Automation Services

### Financial / Market Data (Premium/FIX Adapters)
- StreamBaseFIX / High-Performance FIX Engine
- QuickFIX/J, CameronFIX, Appia FIX engines
- Exegy, Bovespa, CitiFX, Currenex, EBS, FXall, Goldman Sachs, Integral, LavaFX, Lime, Nomura, Raptor, Trading Technologies, UBS, Bolsa Commercio Santiago

### Messaging & Streaming
- Apache Kafka Consumer/Producer (with Avro Schema support in 11.2.0)
- Velocity Analytics Broadcast Server / UTSS

### LiveView Integration
- LiveView Query, Ready, Delete, Publish adapters

---

## 10. LiveView (Real-Time Analytics & Visualization)

| Feature | Description |
|---|---|
| **LiveView Server** | StreamBase application that materializes streaming data into queryable published tables. |
| **LiveQL** | Query language for LiveView tables (snapshot + continuous updates). |
| **LiveView Desktop** | Rich client desktop application for interactive visualization. |
| **LiveView Web** | Browser-based visualization framework (JavaScript / REST). |
| **REST API** | Query LiveView tables over HTTP/REST from any client. |
| **Data Streams for Cloud** | Deploy LiveView tables in private, public, or hybrid cloud environments. |
| **Spotfire Integration** | Direct connection to TIBCO Spotfire for advanced analytics. |

---

## 11. Performance, Scalability & High Availability

| Feature | Description |
|---|---|
| **Latency** | Sub-millisecond to microsecond-scale event processing. |
| **Throughput** | Millions of messages per second per node. |
| **Parallel Regions** | Asynchronously process tuples in isolated execution regions. |
| **HA / Fault Tolerance** | Active/passive pairs, automatic failover, state replication, redundant processing. |
| **Multi-Site Deployment** | Deploy across multiple geographic locations with failover. |
| **Continuous Deployment** | Hot-update flows without stopping the engine. |

---

## 12. Security & Governance

| Feature | Description |
|---|---|
| **Authentication** | LDAP/Active Directory integration. |
| **Authorization / Entitlements** | Field-level and operation-level access control. |
| **SSL/TLS** | Encrypted transport for client and inter-node communication. |
| **Credential Management** | Secure storage of connection credentials. |
| **License Enforcement** | In-product activation with license validation (11.2.1+). |

---

## 13. Extensibility & APIs

| Feature | Description |
|---|---|
| **Java Client API** | Build custom applications that publish/subscribe to StreamBase streams. |
| **.NET Client API** | Windows-native client development. |
| **C++ Client API** | High-performance native client development. |
| **Java Operator SDK** | Build custom operators in Java with full IDE integration. |
| **Java Adapter SDK** | Build embedded input/output adapters in Java. |
| **UDF / UDA** | User-Defined Functions and User-Defined Aggregates in Java or C++. |
| **Custom Functions** | Register Java/C++ functions for use in EventFlow expressions. |

---

## 14. Testing, Debugging & Simulation

| Feature | Description |
|---|---|
| **Graphical Debugger** | Step-through debugging of EventFlow with breakpoints. |
| **Java + Visual Seamless Debug** | Step from EventFlow into embedded Java operator code and back. |
| **Feed Simulation** | Generate synthetic event streams for testing with field/column mapping. |
| **Background Simulation** | Run simulations without blocking the IDE. |
| **Record / Replay** | Capture live streams and replay them against modified applications. |
| **Unit Testing Framework** | Automated testing of modules and operators. |

---

## 15. Administration & Monitoring

| Feature | Description |
|---|---|
| **epadmin CLI** | Command-line tool for node, container, and deployment management. |
| **Statistics Display** | `epadmin display statistics` for runtime metrics. |
| **REST Admin API** | Health checks and administration via HTTP/REST. |
| **Node Status APIs** | Java/.NET/REST APIs for monitoring node health. |
| **Container Management** | Add, remove, start, stop application containers dynamically. |
| **System Service** | Install StreamBase as a OS system service. |
| **Run Configurations** | Parameterized launch profiles within Studio. |

---

## 16. AI / Model Management (11.2.0+)

| Feature | Description |
|---|---|
| **Model Management Server** | Manage and deploy analytic models and decision tables to streaming clusters. |
| **Decision Table Operator** | Embed business rules as decision tables inside EventFlow. |
| **AI-Powered Applications** | Deploy ML models to real-time streaming pipelines. |

---

## Summary by Category

| Category | Feature Count / Depth |
|---|---|
| Core Engine | Ultra-low latency C++ runtime, clustering, HA |
| Visual Development | Eclipse Studio, EventFlow, StreamSQL, 150+ samples |
| Operators | 15+ built-in operator types + custom Java operators |
| Windowing | Time, count, range, session, multi-dimension |
| Aggregation | 10+ aggregate functions + UDA support |
| Pattern Matching | Pattern operator + StreamSQL `FROM PATTERN` |
| Schema / Types | Strongly-typed tuples, coercion, lists, timestamps |
| Connectors | 50+ adapters including FIX, Kafka, TIBCO stack, market data |
| LiveView | Real-time tables, LiveQL, Web/Desktop clients, cloud |
| Extensibility | Java, .NET, C++ clients; Java Operator/Adapter SDK |
| Operations | epadmin, REST APIs, statistics, container management |
| Security | LDAP, SSL/TLS, entitlements, license enforcement |

---

*Last updated: 2026-05-22*
