"""Translate one checked function to Z3. Only the JSON protocol crosses stdin/stdout."""
import json
import sys
from uuid import UUID
from dataclasses import dataclass

try:
    import z3
except ImportError:
    print(json.dumps({"status": "unverified", "reason": "missing-z3"}))
    sys.exit(0)


@dataclass
class Term:
    value: object
    safe: object = True


class Encoding:
    def __init__(self, types):
        self.sorts = {"byte": z3.BitVecSort(8), "bool": z3.BoolSort(),
                      "u32": z3.BitVecSort(32), "uuid": z3.BitVecSort(128)}
        self.variants = {}
        self.summaries = {}
        self.record_fields = {}
        self.capacities = {}
        for typ in types:
            self.declare(typ)

    def declare(self, typ):
        if isinstance(typ, str) or typ["name"] in self.sorts:
            return
        if "element" in typ:
            self.declare(typ["element"])
        elif "fields" in typ:
            for _, field in typ["fields"]:
                self.declare(field)
        else:
            for variant in typ["variants"]:
                if variant["payload"]:
                    self.declare(variant["payload"])
        index = len(self.sorts)
        datatype = z3.Datatype(f"D{index}")
        if "element" in typ:
            for n in range(typ["capacity"] + 1):
                fields = [(f"s{index}_{n}_{i}", self.sort(typ["element"])) for i in range(n)]
                datatype.declare(f"seq{index}_{n}", *fields)
        elif "fields" in typ:
            fields = [(f"r{index}_{i}", self.sort(t)) for i, (_, t) in enumerate(typ["fields"])]
            datatype.declare(f"mk{index}", *fields)
        else:
            for i, v in enumerate(typ["variants"]):
                fields = [(f"field{index}_{i}", self.sort(v["payload"]))] if v["payload"] else []
                datatype.declare(f"tag{index}_{i}", *fields)
        sort = datatype.create()
        self.sorts[typ["name"]] = sort
        if "element" in typ:
            self.capacities[sort.name()] = typ["capacity"]
        elif "fields" in typ:
            self.record_fields[sort.name()] = {k: i for i, (k, _) in enumerate(typ["fields"])}
        else:
            self.variants[sort.name()] = {v["tag"]: i for i, v in enumerate(typ["variants"])}

    def length(self, value):
        sort = value.sort()
        length = z3.BitVecVal(0, 8)
        for n in range(1, self.capacities[sort.name()] + 1):
            length = z3.If(sort.recognizer(n)(value), z3.BitVecVal(n, 8), length)
        return length

    def sort(self, typ):
        return self.sorts[typ if isinstance(typ, str) else typ["name"]]

    def variable(self, symbol, typ):
        return Term(z3.Const(symbol, self.sort(typ)))

    def call_terms(self, name, values, flags):
        # This request fixes types and flags. Baseline and candidate have distinct
        # graphs. Instantiate the exact precondition and implementation summary.
        key = (id(self.graph), name)
        if key not in self.summaries:
            names, requires, body, ensures = self.graph[name]
            formals = [z3.FreshConst(v.value.sort()) for v in values]
            env = {k: Term(v) for k, v in zip(names, formals, strict=True)}
            pre = self.expression(requires, env, flags)
            result = self.expression(body, env, flags)
            post = self.expression(ensures, {**env, "result": Term(result.value)}, flags)
            self.summaries[key] = (formals, pre, Term(result.value, z3.And(result.safe, post.safe, post.value)))
        formals, pre, result = self.summaries[key]
        bindings = list(zip(formals, [v.value for v in values], strict=True))

        def instantiate(expr):
            return z3.substitute(expr, *bindings) if bindings and not isinstance(expr, bool) else expr

        return (Term(instantiate(pre.value), instantiate(pre.safe)),
                Term(instantiate(result.value), instantiate(result.safe)))

    def expression(self, expr, env, flags):
        if isinstance(expr, bool):
            return Term(z3.BoolVal(expr))
        if isinstance(expr, int):
            return Term(z3.BitVecVal(expr, 8))
        if isinstance(expr, str):
            return env[expr]
        op, *args = expr

        def run(arg):
            return self.expression(arg, env, flags)

        if op == "u32":
            return Term(z3.BitVecVal(args[0], 32))
        if op == "uuid":
            return Term(z3.BitVecVal(UUID(args[0]).int, 128))
        if op == "widen":
            term = run(args[0])
            return Term(z3.ZeroExt(24, term.value), term.safe)
        if op == "flag":
            return flags[args[0]]
        if op == "let":
            name, init, body = args
            bound = run(init)
            result = self.expression(body, {**env, name: Term(bound.value)}, flags)
            return Term(result.value, z3.And(bound.safe, result.safe))
        if op == "items":
            name, actuals = args
            values = [run(arg) for arg in actuals]
            return Term(self.sorts[name].constructor(len(values))(*[v.value for v in values]),
                        z3.And(*[v.safe for v in values]))
        if op == "length":
            seq = run(args[0])
            return Term(self.length(seq.value), seq.safe)
        if op == "fold":
            seq_expr, init, names, step, capacity = args
            seq, acc = run(seq_expr), run(init)
            sort = seq.value.sort()
            length = self.length(seq.value)
            safe = z3.And(seq.safe, acc.safe)
            for i in range(capacity):
                # Inactive selectors are unconstrained by Z3. Both the value and
                # safety contribution of an inactive iteration are discarded.
                item = sort.accessor(capacity, i)(seq.value)
                for n in range(i + 1, capacity):
                    item = z3.If(sort.recognizer(n)(seq.value), sort.accessor(n, i)(seq.value), item)
                index = z3.BitVecVal(i, 8)
                scope = {**env, names[0]: Term(acc.value), names[1]: Term(item), names[2]: Term(index)}
                update = self.expression(step, scope, flags)
                active = z3.ULT(index, length)
                acc = Term(z3.If(active, update.value, acc.value))
                safe = z3.And(safe, z3.Implies(active, update.safe))
            return Term(acc.value, safe)
        if op in ("apply", "attempt"):
            name, actuals = args[:2]
            values = [run(arg) for arg in actuals]
            pre, result = self.call_terms(name, values, flags)
            safe = z3.And(*[v.safe for v in values], pre.safe)
            if op == "attempt":
                sort = self.sorts[args[2]]
                index = run(args[3])
                return Term(z3.If(pre.value, sort.constructor(0)(result.value), sort.constructor(1)(index.value)),
                            z3.And(index.safe, safe, z3.Implies(pre.value, result.safe)))
            return Term(result.value, z3.And(safe, pre.value, result.safe))
        if op == "call":
            _, names, actuals, requires, body, ensures = args
            values = [run(arg) for arg in actuals]
            frame = {k: Term(v.value) for k, v in zip(names, values, strict=True)}
            pre = self.expression(requires, frame, flags)
            result = self.expression(body, frame, flags)
            post = self.expression(ensures, {**frame, "result": Term(result.value)}, flags)
            return Term(result.value, z3.And(*[v.safe for v in values], pre.safe, pre.value,
                                             result.safe, post.safe, post.value))
        if op == "make":
            name, fields = args
            values = [run(expr) for _, expr in fields]
            return Term(self.sorts[name].constructor(0)(*[v.value for v in values]),
                        z3.And(*[v.safe for v in values]))
        if op == "get":
            record = run(args[0])
            sort = record.value.sort()
            index = self.record_fields[sort.name()][args[1]]
            return Term(sort.accessor(0, index)(record.value), record.safe)
        if op == "tag":
            name, tag, *payload = args
            sort = self.sorts[name]
            constructor = sort.constructor(self.variants[sort.name()][tag])
            if payload:
                value = run(payload[0])
                return Term(constructor(value.value), value.safe)
            return Term(constructor())
        if op == "match":
            subject = run(args[0])
            sort = subject.value.sort()
            branches = []
            for tag, binder, body in args[1]:
                i = self.variants[sort.name()][tag]
                scope = env
                if binder:
                    scope = {**env, binder: Term(sort.accessor(i, 0)(subject.value))}
                branches.append((sort.recognizer(i)(subject.value), self.expression(body, scope, flags)))
            # Exhaustiveness was checked by the frontend.
            _, result = branches.pop()
            for guard, branch in reversed(branches):
                result = Term(z3.If(guard, branch.value, result.value),
                              z3.If(guard, branch.safe, result.safe))
            return Term(result.value, z3.And(subject.safe, result.safe))
        left = run(args[0])
        a = left.value
        if op == "not":
            return Term(z3.Not(a), left.safe)
        right = run(args[1])
        b = right.value
        if op == "if":
            other = run(args[2])
            return Term(z3.If(a, b, other.value), z3.And(left.safe, z3.If(a, right.safe, other.safe)))
        if op == "and":
            return Term(z3.And(a, b), z3.And(left.safe, z3.Implies(a, right.safe)))
        if op == "or":
            return Term(z3.Or(a, b), z3.And(left.safe, z3.Implies(z3.Not(a), right.safe)))
        safe = z3.And(left.safe, right.safe)
        if op in ("+", "u32+"):
            return Term(a + b, z3.And(safe, z3.UGE(a + b, a)))
        if op in ("-", "u32-"):
            return Term(a - b, z3.And(safe, z3.UGE(a, b)))
        if op == "=":
            return Term(a == b, safe)
        if op == "<=":
            return Term(z3.ULE(a, b), safe)
        if op == "<":
            return Term(z3.ULT(a, b), safe)
        raise ValueError("Unsupported instruction")

    def decode(self, value, typ):
        if typ == "uuid":
            return str(UUID(int=value.as_long()))
        if typ in ("byte", "u32"):
            return value.as_long()
        if typ == "bool":
            return z3.is_true(value)
        if "element" in typ:
            sort = self.sort(typ)
            n = next(i for i in range(typ["capacity"] + 1) if value.decl() == sort.constructor(i))
            return [self.decode(value.arg(i), typ["element"]) for i in range(n)]
        if "fields" in typ:
            return {k: self.decode(value.arg(i), t) for i, (k, t) in enumerate(typ["fields"])}
        sort = self.sorts[typ["name"]]
        for i, variant in enumerate(typ["variants"]):
            if value.decl() == sort.constructor(i):
                result = {"tag": variant["tag"]}
                if variant["payload"]:
                    result["value"] = self.decode(value.arg(0), variant["payload"])
                return result
        raise ValueError("Unknown model value")


def setup(request):
    f = request["function"]
    encoding = Encoding(request["types"])
    encoding.graph = f.get("graph", {})
    env = {name: encoding.variable(f"p{i}", typ) for i, (name, typ) in enumerate(f["params"])}
    flags = {name: encoding.variable(f"g{i}", "bool") for i, name in enumerate(f["reads"])}
    solver = z3.Solver()
    solver.set(timeout=request["timeoutMs"], random_seed=0)
    return f, encoding, env, flags, solver


def input_model(f, encoding, env, flags, model):
    def decode(term, typ):
        return encoding.decode(model.eval(term.value, model_completion=True), typ)

    return {"args": [decode(env[k], typ) for k, typ in f["params"]],
            "flags": {k: decode(term, "bool") for k, term in flags.items()}}


def verify(request):
    f, encoding, env, flags, solver = setup(request)
    pre = encoding.expression(f["requires"], env, flags)
    body = encoding.expression(f["body"], env, flags)
    post = encoding.expression(f["ensures"], {**env, "result": Term(body.value)}, flags)
    solver.push()
    solver.add(z3.Or(z3.Not(pre.safe), z3.And(pre.value,
                  z3.Not(z3.And(body.safe, post.safe, post.value)))))
    check = solver.check()
    if check == z3.unknown:
        return {"status": "unverified", "reason": solver.reason_unknown()}
    if check == z3.sat:
        return {"status": "violated", "input": input_model(f, encoding, env, flags, solver.model())}
    solver.pop()
    solver.add(pre.safe, pre.value)
    admitted = solver.check()
    if admitted == z3.unknown:
        return {"status": "unverified", "reason": solver.reason_unknown()}
    if admitted == z3.unsat:
        return {"status": "violated", "reason": "empty-admission-domain", "safety": "unsat", "admission": "unsat"}
    return {"status": "proven", "safety": "unsat", "admission": "sat"}


def compare(request):
    old, encoding, env, flags, solver = setup(request)
    new = request["candidate"]
    field = request["relation"]

    def holds(function, field, scope):
        encoding.graph = function.get("graph", {})
        term = encoding.expression(function[field], scope, flags)
        return z3.And(term.safe, term.value)

    admitted_old = holds(old, "requires", env)
    admitted_new = holds(new, "requires", env)
    solver.add(admitted_old)
    if field == "requires":
        solver.add(z3.Not(admitted_new))
    elif field == "ensures":
        result = encoding.variable("hypothetical", old["output"])
        scope = {**env, "result": result}
        solver.add(admitted_new, holds(new, field, scope), z3.Not(holds(old, field, scope)))
    elif field == "body":
        # Both complete functions have already been proven safe on admitted inputs.
        encoding.graph = old.get("graph", {})
        a = encoding.expression(old[field], env, flags)
        encoding.graph = new.get("graph", {})
        b = encoding.expression(new[field], env, flags)
        solver.add(admitted_new, a.value != b.value)
    else:
        raise ValueError("Unknown relation")

    check = solver.check()
    if check == z3.unknown:
        return {"status": "unverified", "reason": solver.reason_unknown()}
    answer = {"relation": field, "answer": str(check)}
    if check == z3.sat:
        model = solver.model()
        answer["input"] = input_model(old, encoding, env, flags, model)
        if field == "ensures":
            value = model.eval(result.value, model_completion=True)
            answer["input"]["result"] = encoding.decode(value, old["output"])
    return answer


if __name__ == "__main__":
    request = json.load(sys.stdin)
    result = compare(request) if "relation" in request else verify(request)
    print(json.dumps({**result, "solverVersion": z3.get_version_string()}))
