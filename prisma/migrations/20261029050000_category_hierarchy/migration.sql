ALTER TABLE categories ADD COLUMN parent_id UUID, ADD COLUMN color TEXT;
ALTER TABLE categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD CONSTRAINT categories_not_self CHECK (parent_id IS DISTINCT FROM id);
DROP INDEX categories_book_id_kind_name_key;
CREATE UNIQUE INDEX categories_root_name_key ON categories(book_id, kind, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX categories_sibling_name_key ON categories(book_id, kind, parent_id, name) WHERE parent_id IS NOT NULL;
CREATE INDEX categories_book_id_kind_name_idx ON categories(book_id, kind, name);
CREATE INDEX categories_parent_id_idx ON categories(parent_id);

-- 所有结构写入按账本串行；API 另在事务开头取同一锁，保证并发校验读到已提交关系。
CREATE FUNCTION validate_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ancestor RECORD; seen UUID[] := ARRAY[NEW.id]; cursor_id UUID := NEW.parent_id; depth INTEGER := 1;
BEGIN
  PERFORM id FROM books WHERE id = NEW.book_id FOR UPDATE;
  IF NEW.is_system AND NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'category_tree_invalid' USING ERRCODE='23514'; END IF;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = ANY(seen) OR depth >= 64 THEN RAISE EXCEPTION 'category_tree_invalid' USING ERRCODE='23514'; END IF;
    SELECT id, parent_id, book_id, kind, is_system INTO ancestor FROM categories WHERE id=cursor_id;
    IF NOT FOUND OR ancestor.book_id <> NEW.book_id OR ancestor.kind <> NEW.kind OR ancestor.is_system THEN
      RAISE EXCEPTION 'category_tree_invalid' USING ERRCODE='23514';
    END IF;
    seen := array_append(seen, cursor_id); cursor_id := ancestor.parent_id; depth := depth+1;
  END LOOP;
  -- 移动祖先时也校验整个后代深度；API 的纯函数验证给出更友好的 4xx。
  IF EXISTS (WITH RECURSIVE descendants(id, d) AS (
    SELECT id, 1 FROM categories WHERE parent_id=NEW.id
    UNION ALL SELECT c.id, d.d+1 FROM categories c JOIN descendants d ON c.parent_id=d.id WHERE d.d<64
  ) SELECT 1 FROM descendants WHERE d+depth>64) THEN RAISE EXCEPTION 'category_tree_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER categories_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id, book_id, kind, is_system ON categories
FOR EACH ROW EXECUTE FUNCTION validate_category_hierarchy();
