"""Translate one checked function to Z3. Only the JSON protocol crosses stdin/stdout."""
import json
import sys
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
    def __init__(self, enums):
        self.sorts = {"byte": z3.BitVecSort(8), "bool": z3.BoolSort()}
        self.variants = {}
        for index, enum in enumerate(enums):
            datatype = z3.Datatype(f"E{index}")
            for i, variant in enumerate(enum["variants"]):
                payload = variant["payload"]
                fields = [(f"field{index}_{i}", self.sorts[payload])] if payload else []
                datatype.declare(f"tag{index}_{i}", *fields)
            sort = datatype.create()
            self.sorts[enum["name"]] = sort
            self.variants[sort.name()] = {v["tag"]: i for i, v in enumerate(enum["variants"])}

    def variable(self, symbol, typ):
        key = typ if isinstance(typ, str) else typ["name"]
        return Term(z3.Const(symbol, self.sorts[key]))

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

        if op == "flag":
            return flags[args[0]]
        if op == "let":
            name, init, body = args
            bound = run(init)
            result = self.expression(body, {**env, name: Term(bound.value)}, flags)
            return Term(result.value, z3.And(bound.safe, result.safe))
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
        if op == "+":
            return Term(a + b, z3.And(safe, z3.UGE(a + b, a)))
        if op == "-":
            return Term(a - b, z3.And(safe, z3.UGE(a, b)))
        if op == "=":
            return Term(a == b, safe)
        if op == "<=":
            return Term(z3.ULE(a, b), safe)
        if op == "<":
            return Term(z3.ULT(a, b), safe)
        raise ValueError("Unsupported instruction")

    def decode(self, value, typ):
        if typ == "byte":
            return value.as_long()
        if typ == "bool":
            return z3.is_true(value)
        sort = self.sorts[typ["name"]]
        for i, variant in enumerate(typ["variants"]):
            if value.decl() == sort.constructor(i):
                result = {"tag": variant["tag"]}
                if variant["payload"]:
                    result["value"] = self.decode(value.arg(0), variant["payload"])
                return result
        raise ValueError("Unknown model value")


def verify(request):
    f = request["function"]
    encoding = Encoding(request["enums"])
    env = {name: encoding.variable(f"p{i}", typ) for i, (name, typ) in enumerate(f["params"])}
    flags = {name: encoding.variable(f"g{i}", "bool") for i, name in enumerate(f["reads"])}
    pre = encoding.expression(f["requires"], env, flags)
    body = encoding.expression(f["body"], env, flags)
    post = encoding.expression(f["ensures"], {**env, "result": Term(body.value)}, flags)
    solver = z3.Solver()
    solver.set(timeout=request["timeoutMs"], random_seed=0)
    solver.push()
    solver.add(z3.Or(z3.Not(pre.safe), z3.And(pre.value,
                  z3.Not(z3.And(body.safe, post.safe, post.value)))))
    check = solver.check()
    if check == z3.unknown:
        return {"status": "unverified", "reason": solver.reason_unknown()}
    if check == z3.sat:
        model = solver.model()

        def witness(term, typ):
            return encoding.decode(model.eval(term.value, model_completion=True), typ)

        return {"status": "violated", "input": {
            "args": [witness(env[k], typ) for k, typ in f["params"]],
            "flags": {k: witness(term, "bool") for k, term in flags.items()}}}
    solver.pop()
    solver.add(pre.safe, pre.value)
    admitted = solver.check()
    if admitted == z3.unknown:
        return {"status": "unverified", "reason": solver.reason_unknown()}
    if admitted == z3.unsat:
        return {"status": "violated", "reason": "empty-admission-domain"}
    return {"status": "proven", "safety": "unsat", "admission": "sat"}


if __name__ == "__main__":
    result = verify(json.load(sys.stdin))
    print(json.dumps({**result, "solverVersion": z3.get_version_string()}))
