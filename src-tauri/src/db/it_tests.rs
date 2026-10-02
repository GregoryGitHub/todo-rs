//! Testes de integração do driver SQL Server. Só rodam com um servidor disponível:
//!
//! ```text
//! docker run -d -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=TodoRs#Test2026" -p 14333:1433 mcr.microsoft.com/mssql/server:2022-latest
//! TODORS_MSSQL_TEST="localhost,14333,sa,TodoRs#Test2026" cargo test it_ -- --test-threads=1
//! ```

use std::time::Duration;

use serde_json::{json, Value};

use super::driver::*;

struct Collect(Vec<ExecEvent>);

impl EventSink for Collect {
    fn send(&mut self, event: ExecEvent) -> DbResult<()> {
        self.0.push(event);
        Ok(())
    }
}

impl Collect {
    fn rows(&self, index: usize) -> Vec<Vec<Value>> {
        self.0
            .iter()
            .filter_map(|e| match e {
                ExecEvent::Rows { index: i, rows } if *i == index => Some(rows.clone()),
                _ => None,
            })
            .flatten()
            .collect()
    }

    fn columns(&self, index: usize) -> Vec<ColumnMeta> {
        self.0
            .iter()
            .find_map(|e| match e {
                ExecEvent::ResultStart { index: i, columns } if *i == index => Some(columns.clone()),
                _ => None,
            })
            .unwrap_or_default()
    }
}

fn config(database: &str) -> Option<(ConnConfig, String)> {
    let spec = std::env::var("TODORS_MSSQL_TEST").ok()?;
    let parts: Vec<&str> = spec.splitn(4, ',').collect();
    let cfg = ConnConfig {
        id: "it".into(),
        driver: "mssql".into(),
        host: parts[0].into(),
        port: Some(parts[1].parse().unwrap()),
        instance: None,
        database: database.into(),
        auth: AuthConfig { kind: "sql".into(), user: parts[2].into(), tenant: String::new(), client_id: String::new() },
        encrypt: "on".into(),
        trust_server_certificate: true,
        read_intent: false,
        connect_timeout_s: 15,
    };
    Some((cfg, parts[3].to_string()))
}

async fn session(database: &str) -> Option<Box<dyn Session>> {
    let (cfg, pw) = config(database)?;
    Some(driver_for("mssql").unwrap().connect(&cfg, "", Secret::Password(pw)).await.expect("connect"))
}

async fn exec(s: &mut Box<dyn Session>, sql: &str) -> (Collect, ExecSummary) {
    let mut sink = Collect(Vec::new());
    let summary = s.execute(sql, &mut sink, None).await.unwrap_or_else(|e| panic!("{sql}\n=> {e}"));
    (sink, summary)
}

const SETUP: &str = "
IF DB_ID('TodoRsIt') IS NULL CREATE DATABASE TodoRsIt;
";

const SCHEMA: &str = "
IF OBJECT_ID('dbo.orders') IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.patients') IS NOT NULL DROP TABLE dbo.patients;
CREATE TABLE dbo.patients (
    id uniqueidentifier NOT NULL CONSTRAINT pk_patients PRIMARY KEY DEFAULT NEWID(),
    name nvarchar(200) NOT NULL,
    born date NULL,
    weight decimal(9,3) NULL,
    big bigint NULL,
    active bit NOT NULL DEFAULT 1,
    created datetime2(7) NOT NULL DEFAULT SYSDATETIME(),
    avatar varbinary(max) NULL,
    notes nvarchar(max) NULL
);
CREATE TABLE dbo.orders (
    id int IDENTITY(1,1) PRIMARY KEY,
    patient_id uniqueidentifier NOT NULL CONSTRAINT fk_orders_patient REFERENCES dbo.patients(id),
    total money NOT NULL,
    total_x2 AS (total * 2)
);
CREATE INDEX ix_orders_patient ON dbo.orders(patient_id) INCLUDE (total);
";

#[tokio::test]
async fn it_end_to_end() {
    let Some(mut master) = session("master").await else {
        eprintln!("TODORS_MSSQL_TEST não definido; teste ignorado");
        return;
    };
    let info = master.server_info().await.unwrap();
    assert!(info.product.starts_with("SQL Server"), "{info:?}");
    exec(&mut master, SETUP).await;
    master.close().await;

    let mut s = session("TodoRsIt").await.unwrap();
    exec(&mut s, SCHEMA).await;

    // DML simples devolve linhas afetadas.
    let (_, sum) = exec(
        &mut s,
        "INSERT INTO dbo.patients (id, name, born, weight, big, avatar, notes) VALUES \
         ('6F9619FF-8B86-D011-B42D-00C04FC964FF', N'Ana ''Lú''', '1990-05-01', 61.250, 9007199254740993, 0xCAFE, N'linha1\nlinha2'), \
         (NEWID(), N'Bruno', NULL, NULL, NULL, NULL, NULL)",
    )
    .await;
    assert_eq!(sum.rows_affected, Some(2));

    // Tipos convertidos sem perder precisão.
    let (c, sum) = exec(&mut s, "SELECT id, name, born, weight, big, active, created, avatar, notes FROM dbo.patients ORDER BY name").await;
    assert_eq!(sum.result_sets, 1);
    let cols = c.columns(0);
    let kinds: Vec<&str> = cols.iter().map(|c| c.kind).collect();
    assert_eq!(kinds, ["guid", "str", "date", "dec", "int", "bool", "datetime", "bin", "str"]);
    let rows = c.rows(0);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][0], json!("6F9619FF-8B86-D011-B42D-00C04FC964FF"));
    assert_eq!(rows[0][1], json!("Ana 'Lú'"));
    assert_eq!(rows[0][2], json!("1990-05-01"));
    assert_eq!(rows[0][3], json!("61.250"));
    assert_eq!(rows[0][4], json!("9007199254740993"));
    assert_eq!(rows[0][5], json!(true));
    assert_eq!(rows[0][7], json!("0xCAFE"));
    assert_eq!(rows[1][2], Value::Null);
    let created = rows[0][6].as_str().unwrap();
    assert_eq!(created.len(), "2026-01-01 00:00:00.0000000".len(), "{created}");
    let (c, _) = exec(&mut s, "SELECT CAST('2026-01-02 03:04:05.123' AS datetime), CAST('2026-01-02 03:04:05.1234567 -03:00' AS datetimeoffset), CAST('10:11:12.5' AS time(7))").await;
    assert_eq!(c.rows(0), vec![vec![json!("2026-01-02 03:04:05.123"), json!("2026-01-02 03:04:05.1234567 -03:00"), json!("10:11:12.5000000")]]);

    // Vários result sets e limite de linhas por result set.
    let (_, _) = exec(&mut s, "INSERT INTO dbo.orders (patient_id, total) SELECT TOP 1 id, 10.5 FROM dbo.patients").await;
    let mut sink = Collect(Vec::new());
    let sum = s
        .execute("SELECT TOP 50 a.object_id FROM sys.objects a CROSS JOIN sys.objects b; SELECT total, total_x2 FROM dbo.orders", &mut sink, Some(10))
        .await
        .unwrap();
    assert_eq!(sum.result_sets, 2);
    assert!(sum.truncated);
    assert_eq!(sink.rows(0).len(), 10);
    assert_eq!(sink.rows(1), vec![vec![json!(10.5), json!(21.0)]]);

    // Erro do servidor não derruba a sessão.
    let mut sink = Collect(Vec::new());
    let err = s.execute("SELECT * FROM tabela_que_nao_existe", &mut sink, None).await.unwrap_err();
    assert!(err.contains("208"), "{err}");
    assert!(!s.is_broken());
    let (c, _) = exec(&mut s, "SELECT 1 AS ok").await;
    assert_eq!(c.rows(0), vec![vec![json!(1)]]);

    // Introspecção.
    let schemas = s.introspect(&ObjectPath { kind: "schemas".into(), schema: String::new(), name: String::new() }).await.unwrap();
    assert!(schemas.iter().any(|n| n.name == "dbo"));
    let objects = s.introspect(&ObjectPath { kind: "schema".into(), schema: "dbo".into(), name: String::new() }).await.unwrap();
    assert!(objects.iter().any(|n| n.name == "patients" && n.kind == "table" && n.rows == Some(2)));
    let children = s.introspect(&ObjectPath { kind: "table".into(), schema: "dbo".into(), name: "orders".into() }).await.unwrap();
    assert!(children.iter().any(|n| n.kind == "fk" && n.name == "fk_orders_patient"));
    assert!(children.iter().any(|n| n.kind == "index" && n.name == "ix_orders_patient"));
    let info = s.table_info("dbo", "orders").await.unwrap();
    assert!(info.columns[0].is_pk && info.columns[0].is_identity);
    assert_eq!(info.columns[1].fk.as_ref().unwrap().table, "patients");
    assert!(info.columns[3].is_computed);
    let ddl = s.ddl(&ObjectPath { kind: "table".into(), schema: "dbo".into(), name: "orders".into() }).await.unwrap();
    assert!(ddl.contains("IDENTITY(1, 1)") && ddl.contains("FOREIGN KEY") && ddl.contains("INCLUDE ([total])"), "{ddl}");

    // apply: transação própria, tudo ou nada.
    let err = s
        .apply(&["UPDATE dbo.patients SET name = N'X' WHERE name = N'Bruno'".into(), "INSERT INTO dbo.orders (patient_id, total) VALUES (NEWID(), 1)".into()], true)
        .await
        .unwrap_err();
    assert!(err.starts_with("Comando 2 de 2"), "{err}");
    let (c, _) = exec(&mut s, "SELECT COUNT(*) FROM dbo.patients WHERE name = N'X'").await;
    assert_eq!(c.rows(0), vec![vec![json!(0)]], "rollback esperado");
    let affected = s.apply(&["UPDATE dbo.patients SET name = N'Bia' WHERE name = N'Bruno'".into()], true).await.unwrap();
    assert_eq!(affected, vec![1]);

    // Transação manual.
    assert_eq!(s.begin().await.unwrap(), 1);
    exec(&mut s, "DELETE FROM dbo.orders").await;
    assert_eq!(s.rollback().await.unwrap(), 0);
    let (c, _) = exec(&mut s, "SELECT COUNT(*) FROM dbo.orders").await;
    assert_eq!(c.rows(0), vec![vec![json!(1)]]);

    // Cancelamento: o future é descartado e a sessão se marca para reabrir;
    // fechar o socket aborta o lote e desfaz a transação no servidor.
    assert_eq!(s.begin().await.unwrap(), 1);
    exec(&mut s, "UPDATE dbo.patients SET name = N'cancelado' WHERE name = N'Bia'").await;
    {
        let mut sink = Collect(Vec::new());
        let fut = s.execute("WAITFOR DELAY '00:00:30'; SELECT 1", &mut sink, None);
        let r = tokio::time::timeout(Duration::from_millis(500), fut).await;
        assert!(r.is_err(), "deveria estar esperando");
    }
    s.cancel().await;
    assert!(s.is_broken());
    drop(s);
    let mut s = session("TodoRsIt").await.unwrap();
    let (c, _) = exec(&mut s, "SELECT COUNT(*) FROM dbo.patients WHERE name = N'cancelado'").await;
    assert_eq!(c.rows(0), vec![vec![json!(0)]], "transação desfeita pelo servidor");
    s.close().await;
}

