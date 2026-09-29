# -*- coding: utf-8 -*-
"""BGE-M3 稠密向量（绕过 transformers AutoTokenizer 原生崩溃）。"""
import os
import torch
from tokenizers import Tokenizer
from transformers import AutoModel


class DenseEmbedder:
    def __init__(self, model_dir: str, device: str = "cpu"):
        self.tokenizer = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.model = AutoModel.from_pretrained(model_dir)
        self.device = device
        self.model.to(device)
        self.model.eval()

    def encode(self, texts, batch_size=16):
        vecs = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            enc = [self.tokenizer.encode(t).ids for t in batch]
            max_len = max(len(x) for x in enc)
            ids = torch.zeros(len(batch), max_len, dtype=torch.long, device=self.device)
            att = torch.zeros(len(batch), max_len, dtype=torch.long, device=self.device)
            for j, e in enumerate(enc):
                ids[j, :len(e)] = torch.tensor(e, dtype=torch.long, device=self.device)
                att[j, :len(e)] = 1
            with torch.no_grad():
                out = self.model(input_ids=ids, attention_mask=att)
            h = out.last_hidden_state
            mask = att.unsqueeze(-1).float()
            emb = (h * mask).sum(1) / mask.sum(1).clamp(min=1)
            emb = torch.nn.functional.normalize(emb, p=2, dim=1).cpu()
            vecs.append(emb)
        return torch.cat(vecs, dim=0).numpy()
