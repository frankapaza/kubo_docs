# Modelo de datos

## Diagrama (ER resumido)

```
users ───┐
         ├──▶ project_members ──▶ projects
         │                           │
         │                           ▼
         └──▶ audit_log          meetings ──▶ participants
                                    │             │
                                    │             └─(user_id opcional)
                                    ├──▶ agenda_items
                                    ├──▶ audio_files ──▶ transcriptions
                                    │                        │
                                    └──▶ actas ◀─────────────┘
                                           │
                                           ├──▶ agreements (acuerdos)
                                           └──▶ commitments (compromisos)
```

## Tablas principales

### `users`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| email | VARCHAR(180) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt |
| full_name | VARCHAR(180) | |
| role | ENUM('ADMIN','PM','MEMBER') | |
| is_active | TINYINT(1) | |
| created_at / updated_at | DATETIME | |

### `projects`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| code | VARCHAR(30) UNIQUE | p.ej. `KUBO-01` |
| name | VARCHAR(180) | |
| description | TEXT NULL | |
| status | ENUM('ACTIVE','ARCHIVED') | |
| created_by | BIGINT FK users.id | |
| created_at / updated_at | DATETIME | |

### `project_members`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| project_id | BIGINT FK | |
| user_id | BIGINT FK | |
| role_in_project | ENUM('OWNER','EDITOR','VIEWER') | |
| UNIQUE (project_id, user_id) |

### `meetings`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| project_id | BIGINT FK | |
| title | VARCHAR(200) | |
| description | TEXT NULL | |
| scheduled_at | DATETIME | |
| started_at | DATETIME NULL | |
| ended_at | DATETIME NULL | |
| location | VARCHAR(180) NULL | sala o link |
| status | ENUM(...) | ver estados en 02-architecture.md |
| created_by | BIGINT FK users.id | |
| created_at / updated_at | DATETIME | |

### `participants`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| meeting_id | BIGINT FK | |
| user_id | BIGINT FK NULL | null si es externo |
| full_name | VARCHAR(180) | |
| email | VARCHAR(180) NULL | |
| role | VARCHAR(80) NULL | rol en la reunión |
| attended | TINYINT(1) DEFAULT 0 | |

### `agenda_items`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| meeting_id | BIGINT FK | |
| order_index | INT | |
| title | VARCHAR(200) | |
| description | TEXT NULL | |
| duration_minutes | INT NULL | |

### `audio_files`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| meeting_id | BIGINT FK | |
| uploaded_by | BIGINT FK users.id | |
| storage_key | VARCHAR(500) | ruta relativa / key S3 |
| original_filename | VARCHAR(255) | |
| mime_type | VARCHAR(80) | |
| size_bytes | BIGINT | |
| duration_seconds | INT NULL | post-proc |
| checksum_sha256 | CHAR(64) NULL | |
| source | ENUM('WEB','MOBILE') | |
| created_at | DATETIME | |

### `transcriptions`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| audio_file_id | BIGINT FK UNIQUE | 1:1 |
| status | ENUM('PENDING','PROCESSING','COMPLETED','FAILED') | |
| provider | VARCHAR(50) | p.ej. `whisper-api` |
| language | VARCHAR(10) NULL | |
| content_text | LONGTEXT NULL | texto plano |
| content_segments_json | JSON NULL | segmentos con timestamps |
| error_message | TEXT NULL | |
| started_at / finished_at | DATETIME NULL | |
| created_at / updated_at | DATETIME | |

### `actas`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| meeting_id | BIGINT FK UNIQUE | 1:1 |
| status | ENUM('DRAFT','IN_REVIEW','APPROVED','EXPORTED') | |
| content_markdown | LONGTEXT | cuerpo editable |
| generated_from_transcription | TINYINT(1) | |
| approved_by | BIGINT FK users.id NULL | |
| approved_at | DATETIME NULL | |
| exported_pdf_key | VARCHAR(500) NULL | storage key PDF |
| version | INT DEFAULT 1 | |
| created_at / updated_at | DATETIME | |

### `agreements` (acuerdos)
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| acta_id | BIGINT FK | |
| description | TEXT | |
| order_index | INT | |

### `commitments` (compromisos / action items)
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| acta_id | BIGINT FK | |
| description | TEXT | |
| assignee_user_id | BIGINT FK users.id NULL | |
| assignee_name | VARCHAR(180) NULL | si externo |
| due_date | DATE NULL | |
| status | ENUM('OPEN','DONE','CANCELLED') DEFAULT 'OPEN' | |

### `audit_log`
| campo | tipo | notas |
|-------|------|-------|
| id | BIGINT PK | |
| user_id | BIGINT FK NULL | null si sistema |
| action | VARCHAR(80) | p.ej. `MEETING_CREATED` |
| entity_type | VARCHAR(60) | |
| entity_id | VARCHAR(60) NULL | |
| payload_json | JSON NULL | before/after |
| ip_address | VARCHAR(45) NULL | |
| user_agent | VARCHAR(255) NULL | |
| created_at | DATETIME | |

## SQL de creación

Ver [backend/sql/schema.sql](../backend/sql/schema.sql).
